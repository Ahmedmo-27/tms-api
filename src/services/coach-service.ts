import { Types } from "mongoose";
import ScheduledClass from "../models/scheduledClass";
import Member from "../models/member";
import Package from "../models/package";
import DeductionLog from "../models/deductionLog";
import Class from "../models/class";
import Coach, { ICoach } from "../models/coach";
import { BadRequestError, ForbiddenError, NotFoundError } from "../core/ApiError";
import {
  ClientResponseDto,
  PaginatedClientsResponseDto,
  DeductSessionRequestDto,
  DeductSessionResponseDto,
  MemberPackageResponseDto,
  ScheduleResponseDto,
  mapDeductSessionResponseDto,
  mapMemberPackageResponseDto,
} from "../dtos/coach.dto";
import { runInTransaction } from "../utils/transaction";
import { addDays, format } from "date-fns";

export class CoachService {
  static async getCoachDocumentByUserId(userId: Types.ObjectId): Promise<ICoach | null> {
    return Coach.findOne({ userId });
  }

  /**
   * Returns the deduplicated list of members who have been booked into any
   * ScheduledClass assigned to the given coach or have PT packages with the coach.
   */
  static async getClients(
    coachDocId: Types.ObjectId,
    options?: { page?: number; limit?: number; search?: string; filter?: string }
  ): Promise<PaginatedClientsResponseDto> {
    const clientsMap = new Map<string, ClientResponseDto>();

    // Source 1: PT clients
    const ptPackages = await Package.find({ coachId: coachDocId });
    const ptPkgIds = ptPackages.map(p => p._id);
    const ptMembers = await Member.find({ "packages.pkgId": { $in: ptPkgIds } }).populate<{ uid: any }>("uid");

    // Source 2: Group session clients
    const classes = await ScheduledClass.find({ coachId: coachDocId });
    const groupUidSet = new Set<string>();
    for (const cls of classes) {
      for (const booking of cls.bookedMembers) {
        groupUidSet.add(booking.uid.toString());
      }
    }

    const groupMembers = [];
    for (const uidStr of groupUidSet) {
      const member = await Member.findOne({ uid: new Types.ObjectId(uidStr) }).populate<{ uid: any }>("uid");
      if (member && member.uid) groupMembers.push(member);
    }

    // Collect all unique pkgIds from both sets of members to find allowed packages
    const allPkgIds = new Set<string>();
    for (const member of ptMembers) {
      member.packages.forEach(p => allPkgIds.add(p.pkgId.toString()));
    }
    for (const member of groupMembers) {
      member.packages.forEach(p => allPkgIds.add(p.pkgId.toString()));
    }

    // Fetch the packages to determine which are allowed (owned by coach or general group packages)
    const packagesInfo = await Package.find({ _id: { $in: Array.from(allPkgIds) } });
    const allowedPkgIdSet = new Set<string>();
    for (const pkg of packagesInfo) {
      if (!pkg.coachId || pkg.coachId.toString() === coachDocId.toString()) {
        allowedPkgIdSet.add(pkg._id.toString());
      }
    }

    // Process PT members
    for (const member of ptMembers) {
      if (!member.uid) continue;
      const uidStr = member.uid._id.toString();
      const activePackagesCount = member.packages.filter(p =>
        allowedPkgIdSet.has(p.pkgId.toString()) && p.status === "ACTIVE"
      ).length;

      clientsMap.set(uidStr, {
        memberId: uidStr,
        name: member.uid.name ?? "",
        email: member.uid.email ?? "",
        phoneNumber: member.uid.phoneNumber ?? "",
        source: ["PT"],
        activePackagesCount
      });
    }

    // Process Group members
    for (const member of groupMembers) {
      const uidStr = member.uid._id.toString();
      const activePackagesCount = member.packages.filter(p =>
        allowedPkgIdSet.has(p.pkgId.toString()) && p.status === "ACTIVE"
      ).length;

      const existing = clientsMap.get(uidStr);
      if (existing) {
        if (!existing.source.includes("GROUP")) {
          existing.source = [...existing.source, "GROUP"];
        }
        existing.activePackagesCount = Math.max(existing.activePackagesCount, activePackagesCount);
      } else {
        clientsMap.set(uidStr, {
          memberId: uidStr,
          name: member.uid.name ?? "",
          email: member.uid.email ?? "",
          phoneNumber: member.uid.phoneNumber ?? "",
          source: ["GROUP"],
          activePackagesCount
        });
      }
    }

    let allClients = Array.from(clientsMap.values());

    // Apply search
    if (options?.search) {
      const q = options.search.toLowerCase();
      allClients = allClients.filter(c => 
        c.name.toLowerCase().includes(q) || c.phoneNumber.includes(options.search!)
      );
    }

    // Apply filter
    if (options?.filter && options.filter !== "All") {
      const f = options.filter;
      if (f === "PT only") {
        allClients = allClients.filter(c => c.source.includes("PT") && !c.source.includes("GROUP"));
      } else if (f === "Group only") {
        allClients = allClients.filter(c => c.source.includes("GROUP") && !c.source.includes("PT"));
      } else if (f === "Both") {
        allClients = allClients.filter(c => c.source.includes("PT") && c.source.includes("GROUP"));
      }
    }

    const total = allClients.length;
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 10;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const paginatedClients = allClients.slice(skip, skip + limit);

    return {
      clients: paginatedClients,
      total,
      page,
      limit,
      totalPages
    };
  }

  /**
   * Returns the PT packages belonging to the specified member that are
   * assigned to the requesting coach.
   *
   * Throws ForbiddenError("ACCESS_DENIED")  if no Authorization_Link exists.
   * Throws NotFoundError("MEMBER_NOT_FOUND") if the Member document is absent.
   *
   * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
   */
  static async getMemberPackages(
    coachDocId: Types.ObjectId,
    memberId: string,
  ): Promise<MemberPackageResponseDto[]> {
    // Fetch the member document
    const member = await Member.findOne({ uid: new Types.ObjectId(memberId) });
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    }

    // Verify Authorization_Link — a ScheduledClass must link this coach to the requested member
    // OR the member must have a PT package assigned to this coach.
    const link = await ScheduledClass.findOne({
      coachId: coachDocId,
      "bookedMembers.uid": new Types.ObjectId(memberId),
    });

    // Fetch the package documents referenced by the member
    const memberPkgIds = member.packages.map(p => p.pkgId);
    const packagesInfo = await Package.find({ _id: { $in: memberPkgIds } });
    
    let hasPtPackage = false;
    const allowedPkgIdSet = new Set<string>();
    const packageCategoryMap = new Map<string, string>();
    for (const pkg of packagesInfo) {
      if (!pkg.coachId || pkg.coachId.toString() === coachDocId.toString()) {
        allowedPkgIdSet.add(pkg._id.toString());
        packageCategoryMap.set(pkg._id.toString(), pkg.category);
        if (pkg.coachId && pkg.coachId.toString() === coachDocId.toString()) {
          hasPtPackage = true;
        }
      }
    }

    if (!link && !hasPtPackage) {
      throw new ForbiddenError("ACCESS_DENIED", "No scheduled class or personal package links this coach to the member");
    }

    // Filter member packages to those whose pkgId is in the allowed set
    const filtered = member.packages.filter((pkg) =>
      allowedPkgIdSet.has(pkg.pkgId.toString()),
    );

    if (filtered.length === 0) {
      return [];
    }

    // Map each filtered package to the response DTO (expiry computed server-side)
    return filtered.map((pkg) => {
      const dto = mapMemberPackageResponseDto(pkg);
      const category = packageCategoryMap.get(pkg.pkgId.toString());
      return { ...dto, isPtPackage: category === "PERSONAL_TRAINING" };
    });
  }

  /**
   * Deducts one session from the specified member's package, identified by
   * `memberPackageStartDate`, and creates an audit `DeductionLog` record.
   *
   * The entire operation is executed atomically inside a single MongoDB
   * transaction via `runInTransaction`.
   *
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
   */
  static async deductSession(
    coachDocId: Types.ObjectId,
    dto: DeductSessionRequestDto,
  ): Promise<DeductSessionResponseDto> {
    const { memberId, memberPackageStartDate, reason, sessionDate, sessionType } = dto;

    // --- 1. Validate required fields (Req 7.1) ---
    if (!memberId || !memberPackageStartDate || !reason || !sessionDate || !sessionType) {
      throw new BadRequestError("MISSING_FIELDS", "One or more required fields are missing");
    }

    // --- 2. Validate date strings are parseable ISO 8601 (Req 7.1) ---
    const parsedPackageStartDate = new Date(memberPackageStartDate);
    const parsedSessionDate = new Date(sessionDate);

    if (isNaN(parsedPackageStartDate.getTime())) {
      throw new BadRequestError("INVALID_FIELDS", "memberPackageStartDate is not a valid ISO 8601 date");
    }
    if (isNaN(parsedSessionDate.getTime())) {
      throw new BadRequestError("INVALID_FIELDS", "sessionDate is not a valid ISO 8601 date");
    }

    // --- 3. Find member and verify Authorization_Link (Req 7.2, 7.3, 7.7) ---
    const member = await Member.findOne({ uid: new Types.ObjectId(memberId) });
    if (!member) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Member not found");
    }

    const link = await ScheduledClass.findOne({
      coachId: coachDocId,
      "bookedMembers.uid": new Types.ObjectId(memberId),
    });

    const memberPkgIds = member.packages.map(p => p.pkgId);
    const packagesInfo = await Package.find({ _id: { $in: memberPkgIds } });
    const hasPtPackage = packagesInfo.some(pkg => pkg.coachId && pkg.coachId.toString() === coachDocId.toString());

    if (!link && !hasPtPackage) {
      throw new ForbiddenError("ACCESS_DENIED", "No scheduled class or personal package links this coach to the member");
    }

    // Date-normalize: match by same calendar day using toDateString() comparison
    // (consistent with the pattern used in editPackageClasses / editExpiryDate)
    const pkg = member.packages.find(
      (p) => p.pkgStartDate.toDateString() === parsedPackageStartDate.toDateString(),
    );

    if (!pkg) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found for the given start date");
    }

    const packageDoc = packagesInfo.find(p => p._id.toString() === pkg.pkgId.toString());
    if (!packageDoc || packageDoc.category !== "PERSONAL_TRAINING") {
      throw new BadRequestError("INVALID_PACKAGE", "Deduction is only allowed for Personal Training packages");
    }

    // --- 5. Check remainingClasses > 0 (Req 7.4) ---
    if (pkg.remainingClasses <= 0) {
      throw new BadRequestError("NO_CLASSES_REMAINING", "No remaining classes in this package");
    }

    // --- 6. Check status === "ACTIVE" (Req 7.4) ---
    if (pkg.status !== "ACTIVE") {
      throw new BadRequestError("PACKAGE_NOT_ACTIVE", "Package is not active");
    }

    // --- 7. Execute atomic transaction (Req 7.5) ---
    const classesRemainingAfter = pkg.remainingClasses - 1;

    await runInTransaction(async (session) => {
      // (a) Decrement remainingClasses on the matched package subdocument
      await Member.updateOne(
        { uid: new Types.ObjectId(memberId) },
        { $inc: { "packages.$[pkg].remainingClasses": -1 } },
        {
          arrayFilters: [
            {
              "pkg.pkgStartDate": parsedPackageStartDate,
            },
          ],
          session,
        },
      );

      // (b) Create the DeductionLog record
      await new DeductionLog({
        coachId: coachDocId,
        memberId: new Types.ObjectId(memberId),
        pkgId: pkg.pkgId,
        memberPackageStartDate: parsedPackageStartDate,
        reason,
        sessionDate: parsedSessionDate,
        sessionType,
        classesRemainingAfter,
      }).save({ session });
    });

    // --- 8. Return the updated Member_Package subdocument (Req 7.6) ---
    // Construct the updated state from known values (avoids a second DB round-trip)
    const updatedPkg = {
      ...pkg.toObject(),
      remainingClasses: classesRemainingAfter,
    };

    return mapDeductSessionResponseDto(updatedPkg);
  }

  static async getSchedule(coachDocId: Types.ObjectId, weekStart: Date): Promise<ScheduleResponseDto> {
    const weekEnd = addDays(weekStart, 7);
    const scheduledClasses = await ScheduledClass.find({
      coachId: coachDocId,
      startTime: { $gte: weekStart, $lt: weekEnd }
    }).sort({ startTime: 1 });

    const sessionsMap = new Map<string, any[]>();

    for (const scheduledClass of scheduledClasses) {
      const cls = await Class.findById(scheduledClass.cid);
      if (!cls) continue;

      const clients = [];
      for (const entry of scheduledClass.bookedMembers) {
        const member = await Member.findOne({ uid: entry.uid }).populate<{ uid: any }>("uid");
        if (!member || !member.uid) continue;

        // Fetch the package documents referenced by the member to check if they are allowed
        const memberPkgIds = member.packages.map(p => p.pkgId);
        const packagesInfo = await Package.find({ _id: { $in: memberPkgIds } });
        
        const allowedPkgIdSet = new Set<string>();
        for (const pkg of packagesInfo) {
          if (!pkg.coachId || pkg.coachId.toString() === coachDocId.toString()) {
            allowedPkgIdSet.add(pkg._id.toString());
          }
        }

        const activePackage = member.packages.find(p =>
          p.pkgId && allowedPkgIdSet.has(p.pkgId.toString()) && p.status === "ACTIVE"
        );

        clients.push({
          memberId: entry.uid.toString(),
          name: member.uid.name ?? "",
          phoneNumber: member.uid.phoneNumber ?? "",
          bookingMethod: entry.method,
          activePackage: activePackage ? {
            pkgId: activePackage.pkgId.toString(),
            pkgStartDate: activePackage.pkgStartDate.toISOString(),
            remainingClasses: activePackage.remainingClasses
          } : null
        });
      }

      const dateStr = format(scheduledClass.startTime, "yyyy-MM-dd");
      const sessionDto = {
        scheduledClassId: (scheduledClass._id as Types.ObjectId).toString(),
        classTitle: cls.title,
        category: cls.category,
        startTime: format(scheduledClass.startTime, "HH:mm"),
        endTime: format(scheduledClass.endTime, "HH:mm"),
        capacity: scheduledClass.availableSlots + scheduledClass.bookedMembers.length,
        bookedCount: scheduledClass.bookedMembers.length,
        clients
      };

      if (!sessionsMap.has(dateStr)) {
        sessionsMap.set(dateStr, []);
      }
      sessionsMap.get(dateStr)!.push(sessionDto);
    }

    const days = [];
    for (let i = 0; i <= 6; i++) {
      const currentDate = addDays(weekStart, i);
      const dateStr = format(currentDate, "yyyy-MM-dd");
      days.push({
        date: dateStr,
        dayName: format(currentDate, "EEEE"),
        sessions: sessionsMap.get(dateStr) ?? []
      });
    }

    return {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      days
    };
  }
}
