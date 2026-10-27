import { Types } from "mongoose";
import Member from "../models/member";
import Package from "../models/package";
import User from "../models/user";
import Location from "../models/location";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../core/ApiError";
import { escapeRegex } from "../utils/escapeRegex";

/** Roles a sold package may be credited to. */
export const SALES_ACCOUNT_ROLES = ["sales", "sales_manager"] as const;

export type SellerFilter = "all" | "assigned" | "unassigned" | string;

export interface SoldPackageFilters {
  locationId?: string | null;
  search?: string;
  startDate?: string;
  endDate?: string;
  /** "all" | "assigned" | "unassigned" | a sales account id */
  seller?: SellerFilter;
  page: number;
  limit: number;
}

interface SoldPackageRow {
  memberPackageId: string;
  uid: string;
  memberName: string;
  memberPhone: string;
  pkgId: string;
  packageName: string;
  category: string;
  pkgStartDate: Date;
  pkgEndDate: Date;
  status: string;
  locationId: string | null;
  branchName: string;
  soldBy: { _id: string; name: string; role: string } | null;
  soldByAssignedAt: Date | null;
  soldByAssignedBy: { _id: string; name: string } | null;
}

const idStr = (value: unknown): string =>
  value ? String((value as { _id?: unknown })?._id ?? value) : "";

/** Sold packages are addressed by the member package subdocument id. */
function toMemberPackageId(memberPackageId: string): Types.ObjectId {
  if (!memberPackageId || !Types.ObjectId.isValid(memberPackageId)) {
    throw new BadRequestError(
      "INVALID_MEMBER_PACKAGE_ID",
      "A valid sold package id is required",
    );
  }
  return new Types.ObjectId(memberPackageId);
}

export class SalesService {
  /**
   * Validates a sales account id and returns it as an ObjectId.
   * null / "" clears the attribution.
   */
  static async resolveSalesAccountId(
    soldBy: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (soldBy === null || soldBy === undefined || soldBy === "") return null;
    if (!Types.ObjectId.isValid(soldBy)) {
      throw new BadRequestError(
        "INVALID_SALES_ACCOUNT",
        "Invalid sales account id",
      );
    }
    const account = await User.findById(soldBy).select("_id role");
    if (!account) {
      throw new NotFoundError(
        "SALES_ACCOUNT_NOT_FOUND",
        "Sales account not found",
        { soldBy },
      );
    }
    if (!(SALES_ACCOUNT_ROLES as readonly string[]).includes(account.role)) {
      throw new BadRequestError(
        "NOT_A_SALES_ACCOUNT",
        "A package can only be credited to a sales account",
        { soldBy, role: account.role },
      );
    }
    return account._id as Types.ObjectId;
  }

  /** Sales accounts a sold package can be credited to. */
  static async listSalesAccounts() {
    const accounts = await User.find({
      role: { $in: SALES_ACCOUNT_ROLES as unknown as string[] },
    })
      .select("_id name email phoneNumber role locationId")
      .populate("locationId", "branchName location")
      .sort({ name: 1 })
      .lean();

    return accounts.map((account) => ({
      _id: idStr(account._id),
      name: account.name,
      email: account.email,
      phoneNumber: account.phoneNumber,
      role: account.role,
      branchName:
        (account.locationId as unknown as { branchName?: string })?.branchName ??
        null,
    }));
  }

  /** Match stage for the unwound member packages, without the seller filter. */
  private static async baseMatch(
    filters: SoldPackageFilters,
  ): Promise<Record<string, unknown>> {
    // Legacy rows store the status in mixed case ("Active", "Deleted"), so the
    // removed ones are excluded case-insensitively.
    const match: Record<string, unknown> = {
      "packages.status": { $not: { $regex: "^deleted$", $options: "i" } },
    };

    if (filters.locationId) {
      // locationId is stored as ObjectId on new rows and as a string on legacy
      // ones, so compare on the string form (same approach as location-scope).
      match.$expr = {
        $eq: [{ $toString: "$packages.locationId" }, filters.locationId],
      };
    }

    if (filters.startDate || filters.endDate) {
      const range: Record<string, Date> = {};
      if (filters.startDate) range.$gte = new Date(filters.startDate);
      if (filters.endDate) range.$lte = new Date(filters.endDate);
      match["packages.pkgStartDate"] = range;
    }

    const search = filters.search?.trim();
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const matchedUsers = await User.find({
        $or: [{ name: regex }, { phoneNumber: regex }],
      })
        .select("_id")
        .limit(500)
        .lean();
      match.$or = [
        { uid: { $in: matchedUsers.map((u) => u._id) } },
        { "packages.name": regex },
      ];
    }

    return match;
  }

  private static sellerMatch(
    seller: SellerFilter | undefined,
  ): Record<string, unknown> {
    if (!seller || seller === "all") return {};
    if (seller === "unassigned") {
      // $in: [null] also matches packages saved before this field existed.
      return { "packages.soldBy": { $in: [null] } };
    }
    if (seller === "assigned") {
      return { "packages.soldBy": { $ne: null } };
    }
    if (!Types.ObjectId.isValid(seller)) {
      throw new BadRequestError(
        "INVALID_SALES_ACCOUNT",
        "Invalid sales account id",
      );
    }
    return { "packages.soldBy": new Types.ObjectId(seller) };
  }

  /**
   * Sold packages (one row per member package) with their sales attribution,
   * plus a summary of how the same selection is split across sales accounts.
   */
  static async listSoldPackages(filters: SoldPackageFilters) {
    const match = await SalesService.baseMatch(filters);
    const sellerMatch = SalesService.sellerMatch(filters.seller);
    const skip = (filters.page - 1) * filters.limit;

    const [page, breakdown] = await Promise.all([
      Member.aggregate([
        { $match: { packages: { $exists: true, $ne: [] } } },
        { $unwind: "$packages" },
        { $match: match },
        ...(Object.keys(sellerMatch).length ? [{ $match: sellerMatch }] : []),
        {
          $facet: {
            rows: [
              { $sort: { "packages.pkgStartDate": -1, "packages._id": -1 } },
              { $skip: skip },
              { $limit: filters.limit },
              {
                $project: {
                  _id: 0,
                  uid: 1,
                  memberPackageId: "$packages._id",
                  pkgId: "$packages.pkgId",
                  packageName: "$packages.name",
                  pkgStartDate: "$packages.pkgStartDate",
                  pkgEndDate: "$packages.pkgEndDate",
                  status: "$packages.status",
                  locationId: "$packages.locationId",
                  soldBy: "$packages.soldBy",
                  soldByAssignedAt: "$packages.soldByAssignedAt",
                  soldByAssignedBy: "$packages.soldByAssignedBy",
                },
              },
            ],
            total: [{ $count: "count" }],
          },
        },
      ]),
      Member.aggregate([
        { $match: { packages: { $exists: true, $ne: [] } } },
        { $unwind: "$packages" },
        { $match: match },
        { $group: { _id: "$packages.soldBy", count: { $sum: 1 } } },
      ]),
    ]);

    const raw = (page[0]?.rows ?? []) as Record<string, unknown>[];
    const total = (page[0]?.total?.[0]?.count ?? 0) as number;

    const [users, packages, locations] = await Promise.all([
      User.find({
        _id: {
          $in: [
            ...new Set(
              raw.flatMap((row) =>
                [row.uid, row.soldBy, row.soldByAssignedBy]
                  .filter(Boolean)
                  .map((value) => idStr(value)),
              ),
            ),
          ].map((id) => new Types.ObjectId(id)),
        },
      })
        .select("_id name phoneNumber role")
        .lean(),
      Package.find({
        _id: {
          $in: [
            ...new Set(raw.map((row) => idStr(row.pkgId)).filter(Boolean)),
          ].map((id) => new Types.ObjectId(id)),
        },
      })
        .select("_id name category")
        .lean(),
      Location.find({}).select("_id branchName").lean(),
    ]);

    const userById = new Map(users.map((u) => [idStr(u._id), u]));
    const pkgById = new Map(packages.map((p) => [idStr(p._id), p]));
    const branchById = new Map(
      locations.map((l) => [idStr(l._id), l.branchName]),
    );

    const rows: SoldPackageRow[] = raw.map((row) => {
      const member = userById.get(idStr(row.uid));
      const seller = row.soldBy ? userById.get(idStr(row.soldBy)) : undefined;
      const assignedBy = row.soldByAssignedBy
        ? userById.get(idStr(row.soldByAssignedBy))
        : undefined;
      const catalog = pkgById.get(idStr(row.pkgId));
      const locationId = row.locationId ? idStr(row.locationId) : null;

      return {
        memberPackageId: idStr(row.memberPackageId),
        uid: idStr(row.uid),
        memberName: member?.name ?? "Unknown member",
        memberPhone: member?.phoneNumber ?? "",
        pkgId: idStr(row.pkgId),
        packageName: (row.packageName as string) || catalog?.name || "Package",
        category: catalog?.category ?? "",
        pkgStartDate: row.pkgStartDate as Date,
        pkgEndDate: row.pkgEndDate as Date,
        status: row.status as string,
        locationId,
        branchName: (locationId && branchById.get(locationId)) || "",
        soldBy: seller
          ? { _id: idStr(seller._id), name: seller.name, role: seller.role }
          : null,
        soldByAssignedAt: (row.soldByAssignedAt as Date) ?? null,
        soldByAssignedBy: assignedBy
          ? { _id: idStr(assignedBy._id), name: assignedBy.name }
          : null,
      };
    });

    const sellerIds = breakdown
      .map((entry: { _id: unknown }) => idStr(entry._id))
      .filter(Boolean);
    const sellerAccounts = sellerIds.length
      ? await User.find({
          _id: { $in: sellerIds.map((id) => new Types.ObjectId(id)) },
        })
          .select("_id name")
          .lean()
      : [];
    const sellerNameById = new Map(
      sellerAccounts.map((account) => [idStr(account._id), account.name]),
    );

    const summaryTotal = breakdown.reduce(
      (sum: number, entry: { count: number }) => sum + entry.count,
      0,
    );
    const unassigned = breakdown
      .filter((entry: { _id: unknown }) => !entry._id)
      .reduce((sum: number, entry: { count: number }) => sum + entry.count, 0);

    return {
      rows,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      summary: {
        total: summaryTotal,
        assigned: summaryTotal - unassigned,
        unassigned,
        bySeller: breakdown
          .filter((entry: { _id: unknown }) => Boolean(entry._id))
          .map((entry: { _id: unknown; count: number }) => ({
            salesAccountId: idStr(entry._id),
            name: sellerNameById.get(idStr(entry._id)) ?? "Removed account",
            count: entry.count,
          }))
          .sort(
            (a: { count: number }, b: { count: number }) => b.count - a.count,
          ),
      },
    };
  }

  /**
   * Credits a sold package to a sales account, or clears the attribution.
   * `scopedLocationId` is set for branch_admin, which may only touch sales
   * made at its own branch.
   */
  static async assignSeller(params: {
    memberPackageId: string;
    soldBy: string | null;
    actorId: string;
    scopedLocationId?: string | null;
  }) {
    const memberPackageId = toMemberPackageId(params.memberPackageId);
    const sellerId = await SalesService.resolveSalesAccountId(params.soldBy);

    const member = await Member.findOne({
      "packages._id": memberPackageId,
    }).select("uid packages");
    if (!member) {
      throw new NotFoundError(
        "SOLD_PACKAGE_NOT_FOUND",
        "Sold package not found",
        { memberPackageId: params.memberPackageId },
      );
    }

    const soldPackage = member.packages.find(
      (pkg) => String((pkg as unknown as { _id?: unknown })._id) ===
        String(memberPackageId),
    );
    if (!soldPackage) {
      throw new NotFoundError(
        "SOLD_PACKAGE_NOT_FOUND",
        "Sold package not found",
        { memberPackageId: params.memberPackageId },
      );
    }
    if (String(soldPackage.status).toUpperCase() === "DELETED") {
      throw new BadRequestError(
        "SOLD_PACKAGE_DELETED",
        "This package was removed from the member and cannot be credited",
      );
    }
    if (params.scopedLocationId) {
      const packageLocationId = soldPackage.locationId
        ? String(soldPackage.locationId)
        : null;
      if (packageLocationId !== params.scopedLocationId) {
        throw new ForbiddenError(
          "BRANCH_SCOPE_MISMATCH",
          "This package was not sold at your branch",
        );
      }
    }

    await Member.updateOne(
      { "packages._id": memberPackageId },
      {
        $set: {
          "packages.$.soldBy": sellerId,
          "packages.$.soldByAssignedAt": new Date(),
          "packages.$.soldByAssignedBy": new Types.ObjectId(params.actorId),
        },
      },
    );

    const seller = sellerId
      ? await User.findById(sellerId).select("_id name role").lean()
      : null;

    return {
      memberPackageId: params.memberPackageId,
      uid: String(member.uid),
      soldBy: seller
        ? { _id: idStr(seller._id), name: seller.name, role: seller.role }
        : null,
      soldByAssignedAt: new Date(),
    };
  }
}
