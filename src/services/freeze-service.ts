import { Types, ClientSession } from "mongoose";
import Member, { IMember, IMemberPackageData, IFreezeHistory, IFreezeInfo } from "../models/member";
import Package, { resolvePackageAllowedFreezeDays } from "../models/package";
import FreezeRequest, { IFreezeRequest } from "../models/freezeRequest";
import User from "../models/user";
import Location from "../models/location";
import { BadRequestError, ConflictError, NotFoundError } from "../core/ApiError";
import { isSameCairoDay, toStoredPackageDate, startOfTodayCairo } from "../utils/timezone";
import { NotificationsService } from "./notifications-service";
import logger from "../config/logger";

export interface FreezePackageParams {
  uid: string;
  pkgId: string;
  pkgStartDate: string | Date;
  durationDays: number;
  type?: "STANDARD" | "EXTRA" | "ADMIN";
  reason?: string;
  adminId?: string;
}

export interface UnfreezePackageParams {
  uid: string;
  pkgId: string;
  pkgStartDate: string | Date;
  adminId?: string;
}

export class FreezeService {
  /**
   * Sync and auto-unfreeze packages whose freezeEndDate has passed.
   */
  static async syncMemberFreezeStatus(member: IMember): Promise<boolean> {
    let modified = false;
    const now = new Date();

    for (const pkg of member.packages) {
      if (pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen) {
        if (pkg.freezeInfo?.freezeEndDate && now >= new Date(pkg.freezeInfo.freezeEndDate)) {
          pkg.freezeInfo.isFrozen = false;
          pkg.status = new Date(pkg.pkgEndDate) >= now ? "ACTIVE" : "EXPIRED";
          modified = true;
          logger.info(`Auto-unfroze package ${pkg.pkgId} for member ${member.uid}`);
        }
      }
    }

    if (modified) {
      await member.save();
    }
    return modified;
  }

  /**
   * Freeze an active package on a member.
   */
  static async freezeMemberPackage(params: FreezePackageParams): Promise<IMemberPackageData> {
    const { uid, pkgId, pkgStartDate, durationDays, type = "STANDARD", reason, adminId } = params;

    if (!durationDays || durationDays < 1) {
      throw new BadRequestError("INVALID_DURATION", "Freeze duration must be at least 1 day");
    }

    const member = await Member.findOne({ uid });
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
    }

    await this.syncMemberFreezeStatus(member);

    const pkg = member.packages.find(
      (p) => p.pkgId.toString() === pkgId && isSameCairoDay(p.pkgStartDate, pkgStartDate)
    );

    if (!pkg) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found on member account", { pkgId });
    }

    if (pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen) {
      throw new BadRequestError("PACKAGE_ALREADY_FROZEN", "This package is already frozen");
    }

    if (pkg.status !== "ACTIVE") {
      throw new BadRequestError(
        "PACKAGE_NOT_ACTIVE",
        `Only active packages can be frozen. Current status: ${pkg.status}`
      );
    }

    // Initialize freezeInfo if absent
    if (!pkg.freezeInfo) {
      const catalogPkg = await Package.findById(pkgId);
      const allowedDays = catalogPkg
        ? resolvePackageAllowedFreezeDays(catalogPkg)
        : 0;

      pkg.freezeInfo = {
        isFrozen: false,
        allowedFreezeDays: allowedDays,
        usedFreezeDays: 0,
        extraFreezeDaysApproved: 0,
        freezeHistory: [],
      };
    }

    // Validate quota for standard member freezes
    if (type === "STANDARD") {
      const availableDays = pkg.freezeInfo.allowedFreezeDays - pkg.freezeInfo.usedFreezeDays;
      if (availableDays <= 0) {
        throw new BadRequestError(
          "FREEZE_QUOTA_EXHAUSTED",
          "You have used all allowed freeze duration for this package. You can submit an extra freeze request for additional time."
        );
      }
      if (durationDays > availableDays) {
        throw new BadRequestError(
          "FREEZE_DURATION_EXCEEDS_LIMIT",
          `Requested duration (${durationDays} days) exceeds your remaining allowed freeze quota (${availableDays} day${availableDays === 1 ? "" : "s"}).`
        );
      }
      pkg.freezeInfo.usedFreezeDays += durationDays;
    } else if (type === "EXTRA") {
      pkg.freezeInfo.extraFreezeDaysApproved += durationDays;
    }

    const freezeStart = new Date();
    const freezeEnd = new Date(freezeStart.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Extend pkgEndDate by durationDays
    const currentEndDate = new Date(pkg.pkgEndDate);
    const newEndDate = new Date(currentEndDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    pkg.pkgEndDate = toStoredPackageDate(newEndDate);

    pkg.status = "FROZEN";
    pkg.freezeInfo.isFrozen = true;
    pkg.freezeInfo.freezeStartDate = freezeStart;
    pkg.freezeInfo.freezeEndDate = freezeEnd;

    const historyEntry: IFreezeHistory = {
      startDate: freezeStart,
      endDate: freezeEnd,
      durationDays,
      type,
      reason: reason?.trim(),
      approvedBy: adminId ? new Types.ObjectId(adminId) : undefined,
      createdAt: new Date(),
    };

    if (!pkg.freezeInfo.freezeHistory) {
      pkg.freezeInfo.freezeHistory = [];
    }
    pkg.freezeInfo.freezeHistory.push(historyEntry);

    await member.save();
    return pkg;
  }

  /**
   * Unfreeze a frozen package early.
   */
  static async unfreezeMemberPackage(params: UnfreezePackageParams): Promise<IMemberPackageData> {
    const { uid, pkgId, pkgStartDate, adminId } = params;

    const member = await Member.findOne({ uid });
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
    }

    const pkg = member.packages.find(
      (p) => p.pkgId.toString() === pkgId && isSameCairoDay(p.pkgStartDate, pkgStartDate)
    );

    if (!pkg) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found on member account", { pkgId });
    }

    if (pkg.status !== "FROZEN" && !pkg.freezeInfo?.isFrozen) {
      throw new BadRequestError("PACKAGE_NOT_FROZEN", "This package is not currently frozen");
    }

    const freezeStart = pkg.freezeInfo?.freezeStartDate ? new Date(pkg.freezeInfo.freezeStartDate) : new Date();
    const now = new Date();

    // Calculate actual elapsed days
    const elapsedMs = Math.max(0, now.getTime() - freezeStart.getTime());
    const elapsedDays = Math.ceil(elapsedMs / (1000 * 60 * 60 * 24));

    // Get the scheduled duration from the most recent active freeze
    const historyList = pkg.freezeInfo?.freezeHistory ?? [];
    const lastRecord = historyList.length > 0 ? historyList[historyList.length - 1] : null;
    const scheduledDuration = lastRecord ? lastRecord.durationDays : elapsedDays;

    const actualFrozenDays = Math.min(scheduledDuration, Math.max(1, elapsedDays));
    const unusedDays = Math.max(0, scheduledDuration - actualFrozenDays);

    if (unusedDays > 0 && pkg.freezeInfo) {
      if (lastRecord?.type === "STANDARD") {
        pkg.freezeInfo.usedFreezeDays = Math.max(0, pkg.freezeInfo.usedFreezeDays - unusedDays);
      } else if (lastRecord?.type === "EXTRA") {
        pkg.freezeInfo.extraFreezeDaysApproved = Math.max(0, pkg.freezeInfo.extraFreezeDaysApproved - unusedDays);
      }

      // Revert the unused portion of the expiry extension
      const currentEnd = new Date(pkg.pkgEndDate);
      const adjustedEnd = new Date(currentEnd.getTime() - unusedDays * 24 * 60 * 60 * 1000);
      pkg.pkgEndDate = toStoredPackageDate(adjustedEnd);
    }

    if (lastRecord) {
      lastRecord.endDate = now;
      lastRecord.durationDays = actualFrozenDays;
    }

    if (pkg.freezeInfo) {
      pkg.freezeInfo.isFrozen = false;
    }

    // Determine status based on new expiry date
    pkg.status = new Date(pkg.pkgEndDate) >= now ? "ACTIVE" : "EXPIRED";

    await member.save();
    return pkg;
  }

  /**
   * Member creates an extra freeze request.
   */
  static async requestExtraFreeze(
    uid: string,
    pkgId: string,
    pkgStartDate: string | Date,
    requestedDurationDays: number,
    reason: string
  ): Promise<IFreezeRequest> {
    if (!requestedDurationDays || requestedDurationDays < 1) {
      throw new BadRequestError("INVALID_DURATION", "Requested freeze duration must be at least 1 day");
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestError("REASON_REQUIRED", "A reason explaining why you need extra freeze is required");
    }

    const member = await Member.findOne({ uid });
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
    }

    const pkg = member.packages.find(
      (p) => p.pkgId.toString() === pkgId && isSameCairoDay(p.pkgStartDate, pkgStartDate)
    );

    if (!pkg) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found on member account", { pkgId });
    }

    // Check if there is already a pending request for this package instance
    const existingPending = await FreezeRequest.findOne({
      memberId: new Types.ObjectId(uid),
      pkgId: new Types.ObjectId(pkgId),
      status: "PENDING",
    });

    if (existingPending) {
      throw new ConflictError(
        "PENDING_FREEZE_REQUEST_EXISTS",
        "You already have a pending extra freeze request for this package. Please wait for management review."
      );
    }

    const catalogPkg = await Package.findById(pkgId);
    const pkgName = catalogPkg?.name || (pkg as any).name || "Package";

    const request = new FreezeRequest({
      memberId: new Types.ObjectId(uid),
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: pkg.pkgStartDate,
      pkgName,
      locationId: pkg.locationId || catalogPkg?.locationId || null,
      requestedDurationDays: Number(requestedDurationDays),
      reason: trimmedReason,
      status: "PENDING",
    });

    await request.save();
    return request;
  }

  /**
   * Get freeze requests with filtering and branch location scoping.
   */
  static async getFreezeRequests(params: {
    status?: string;
    locationId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, locationId, search, page = 1, limit = 20 } = params;
    const query: Record<string, any> = {};

    if (status && status !== "ALL") {
      query.status = status;
    }

    if (locationId) {
      query.locationId = new Types.ObjectId(locationId);
    }

    let memberIds: Types.ObjectId[] | undefined;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const matchedUsers = await User.find({
        $or: [{ name: regex }, { phoneNumber: regex }, { email: regex }],
      }).select("_id");
      memberIds = matchedUsers.map((u) => u._id as Types.ObjectId);
      query.memberId = { $in: memberIds };
    }

    const skip = (Math.max(1, page) - 1) * limit;

    const [requests, total] = await Promise.all([
      FreezeRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "memberId", select: "_id name phoneNumber email role" })
        .populate({ path: "locationId", select: "_id branchName location" })
        .populate({ path: "reviewedBy", select: "_id name" }),
      FreezeRequest.countDocuments(query),
    ]);

    return {
      requests,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Approve an extra freeze request with optional edited duration.
   */
  static async approveFreezeRequest(
    requestId: string,
    adminId: string,
    approvedDurationDays?: number,
    adminNote?: string
  ): Promise<IFreezeRequest> {
    const request = await FreezeRequest.findById(requestId);
    if (!request) {
      throw new NotFoundError("REQUEST_NOT_FOUND", "Freeze request not found");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestError("REQUEST_ALREADY_RESOLVED", `This request has already been ${request.status.toLowerCase()}`);
    }

    const finalDuration =
      typeof approvedDurationDays === "number" && approvedDurationDays >= 1
        ? approvedDurationDays
        : request.requestedDurationDays;

    // Apply the freeze directly to the member's package
    await this.freezeMemberPackage({
      uid: request.memberId.toString(),
      pkgId: request.pkgId.toString(),
      pkgStartDate: request.pkgStartDate,
      durationDays: finalDuration,
      type: "EXTRA",
      reason: request.reason,
      adminId,
    });

    request.status = "APPROVED";
    request.approvedDurationDays = finalDuration;
    request.adminNote = adminNote?.trim();
    request.reviewedBy = new Types.ObjectId(adminId);
    request.reviewedAt = new Date();

    await request.save();

    // Send push notification to the member
    try {
      await NotificationsService.sendNotification(
        [request.memberId.toString()],
        "Freeze Request Approved",
        `Your extra freeze request for "${request.pkgName}" has been approved for ${finalDuration} day(s).`,
        {
          type: "FREEZE_REQUEST_APPROVED",
          requestId: String(request._id),
          durationDays: String(finalDuration),
        }
      );
    } catch (err) {
      logger.error("Failed to send freeze approval push notification", { err });
    }

    return request;
  }

  /**
   * Reject an extra freeze request with a rejection reason.
   */
  static async rejectFreezeRequest(
    requestId: string,
    adminId: string,
    rejectionReason?: string
  ): Promise<IFreezeRequest> {
    const request = await FreezeRequest.findById(requestId);
    if (!request) {
      throw new NotFoundError("REQUEST_NOT_FOUND", "Freeze request not found");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestError("REQUEST_ALREADY_RESOLVED", `This request has already been ${request.status.toLowerCase()}`);
    }

    request.status = "REJECTED";
    request.rejectionReason = rejectionReason?.trim();
    request.reviewedBy = new Types.ObjectId(adminId);
    request.reviewedAt = new Date();

    await request.save();

    // Send push notification to the member
    try {
      const reasonText = rejectionReason?.trim()
        ? `: ${rejectionReason.trim()}`
        : ".";
      await NotificationsService.sendNotification(
        [request.memberId.toString()],
        "Freeze Request Declined",
        `Your extra freeze request for "${request.pkgName}" was declined${reasonText}`,
        {
          type: "FREEZE_REQUEST_REJECTED",
          requestId: String(request._id),
        }
      );
    } catch (err) {
      logger.error("Failed to send freeze rejection push notification", { err });
    }

    return request;
  }

  /**
   * Get freeze requests submitted by a specific member.
   */
  static async getMemberFreezeRequests(uid: string): Promise<IFreezeRequest[]> {
    return FreezeRequest.find({ memberId: new Types.ObjectId(uid) })
      .sort({ createdAt: -1 })
      .populate({ path: "locationId", select: "branchName location" });
  }

  /**
   * Get all currently frozen packages across all members with search, pagination, and branch filtering.
   */
  static async getFrozenPackages(params: {
    locationId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { locationId, search, page = 1, limit = 20 } = params;

    let searchUserIds: Types.ObjectId[] | undefined;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const matchedUsers = await User.find({
        $or: [{ name: regex }, { phoneNumber: regex }, { email: regex }],
      }).select("_id");
      searchUserIds = matchedUsers.map((u) => u._id as Types.ObjectId);
    }

    const memberQuery: Record<string, any> = {
      $or: [
        { "packages.status": "FROZEN" },
        { "packages.freezeInfo.isFrozen": true },
      ],
    };

    if (searchUserIds !== undefined) {
      memberQuery.uid = { $in: searchUserIds };
    }

    const [members, catalogPackages, locations] = await Promise.all([
      Member.find(memberQuery)
        .populate({ path: "uid", select: "_id name phoneNumber email role" })
        .lean(),
      Package.find({}).lean(),
      Location.find({}).lean(),
    ]);

    const pkgMap = new Map(catalogPackages.map((p) => [p._id.toString(), p]));
    const locMap = new Map(locations.map((l) => [l._id.toString(), l]));

    const frozenItems: Array<{
      member: {
        _id: string;
        name: string;
        phoneNumber: string;
        email: string;
        role: string;
      };
      pkgId: string;
      pkgName: string;
      pkgStartDate: Date;
      pkgEndDate: Date;
      remainingClasses: number;
      locationId: {
        _id: string;
        branchName: string;
        location: string;
      } | null;
      freezeInfo: any;
      status: string;
    }> = [];

    for (const member of members) {
      const user = member.uid as any;
      if (!user) continue;

      for (const pkg of member.packages) {
        if (pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen) {
          const catalog = pkgMap.get(pkg.pkgId.toString());
          const itemLocationId = pkg.locationId || catalog?.locationId || null;

          if (locationId && itemLocationId && itemLocationId.toString() !== locationId.toString()) {
            continue;
          }

          const loc = itemLocationId ? locMap.get(itemLocationId.toString()) : null;

          frozenItems.push({
            member: {
              _id: user._id?.toString() || member.uid.toString(),
              name: user.name || "Unknown Member",
              phoneNumber: user.phoneNumber || "",
              email: user.email || "",
              role: user.role || "member",
            },
            pkgId: pkg.pkgId.toString(),
            pkgName: catalog?.name || (pkg as any).name || "Package",
            pkgStartDate: pkg.pkgStartDate,
            pkgEndDate: pkg.pkgEndDate,
            remainingClasses: pkg.remainingClasses,
            locationId: loc
              ? {
                  _id: loc._id.toString(),
                  branchName: loc.branchName,
                  location: loc.location,
                }
              : null,
            freezeInfo: pkg.freezeInfo || {
              isFrozen: true,
              freezeStartDate: (pkg as any).freezeStartDate,
              freezeEndDate: (pkg as any).freezeEndDate,
              allowedFreezeDays: 0,
              usedFreezeDays: 0,
              extraFreezeDaysApproved: 0,
              freezeHistory: [],
            },
            status: pkg.status || "FROZEN",
          });
        }
      }
    }

    // Sort by freezeStartDate descending
    frozenItems.sort((a, b) => {
      const dateA = a.freezeInfo?.freezeStartDate
        ? new Date(a.freezeInfo.freezeStartDate).getTime()
        : 0;
      const dateB = b.freezeInfo?.freezeStartDate
        ? new Date(b.freezeInfo.freezeStartDate).getTime()
        : 0;
      return dateB - dateA;
    });

    const total = frozenItems.length;
    const skip = (Math.max(1, page) - 1) * limit;
    const paginated = frozenItems.slice(skip, skip + limit);

    return {
      packages: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
