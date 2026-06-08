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
  static async getClients(coachDocId: Types.ObjectId): Promise<ClientResponseDto[]> {
    const clientsMap = new Map<string, ClientResponseDto>();

    // Source 1: PT clients
    const packages = await Package.find({ coachId: coachDocId });
    const ptPkgIds = packages.map(p => p._id);
    const ptMembers = await Member.find({ "packages.pkgId": { $in: ptPkgIds } }).populate<{ uid: any }>("uid");

    for (const member of ptMembers) {
      if (!member.uid) continue;
      const uidStr = member.uid._id.toString();
      const activePackagesCount = member.packages.filter(p =>
        ptPkgIds.some(id => id.equals(p.pkgId)) && p.status === "ACTIVE"
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

    // Source 2: Group session clients
    const classes = await ScheduledClass.find({ coachId: coachDocId });
    const groupUidSet = new Set<string>();
    for (const cls of classes) {
      for (const booking of cls.bookedMembers) {
        groupUidSet.add(booking.uid.toString());
      }
    }

    for (const uidStr of groupUidSet) {
      const member = await Member.findOne({ uid: new Types.ObjectId(uidStr) }).populate<{ uid: any }>("uid");
      if (!member || !member.uid) continue;

      const activePackagesCount = member.packages.filter(p => p.status === "ACTIVE").length;

      const existing = clientsMap.get(uidStr);
      if (existing) {
        existing.source = [...existing.source, "GROUP"];
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

    return Array.from(clientsMap.values());
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
    // Verify Authorization_Link — at least one ScheduledClass must link this
    // coach to the requested member.
    const link = await ScheduledClass.findOne({
      coachId: coachDocId,
      "bookedMembers.uid": new Types.ObjectId(memberId),
    });

    if (!link) {
      throw new ForbiddenError("ACCESS_DENIED", "No scheduled class links this coach to the member");
    }

    // Fetch the member document
    const member = await Member.findOne({ uid: new Types.ObjectId(memberId) });
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    }

    // Fetch all Package documents assigned to this coach to build the allowed
    // pkgId set.  Package.coachId is stored as an ObjectId in MongoDB even
    // though the TypeScript interface declares it as string — compare via
    // .toString() to stay safe.
    const coachPackages = await Package.find({ coachId: coachDocId });
    const coachPkgIdSet = new Set<string>(
      coachPackages.map((p) => (p._id as Types.ObjectId).toString()),
    );

    // Filter member packages to those whose pkgId is in the coach-assigned set
    const filtered = member.packages.filter((pkg) =>
      coachPkgIdSet.has(pkg.pkgId.toString()),
    );

    if (filtered.length === 0) {
      return [];
    }

    // Map each filtered package to the response DTO (expiry computed server-side)
    return filtered.map((pkg) => mapMemberPackageResponseDto(pkg));
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

    // --- 3. Verify Authorization_Link (Req 7.2, 7.7) ---
    const link = await ScheduledClass.findOne({
      coachId: coachDocId,
      "bookedMembers.uid": new Types.ObjectId(memberId),
    });

    if (!link) {
      throw new ForbiddenError("ACCESS_DENIED", "No scheduled class links this coach to the member");
    }

    // --- 4. Find member and locate the package subdocument (Req 7.3) ---
    const member = await Member.findOne({ uid: new Types.ObjectId(memberId) });
    if (!member) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Member not found");
    }

    // Date-normalize: match by same calendar day using toDateString() comparison
    // (consistent with the pattern used in editPackageClasses / editExpiryDate)
    const pkg = member.packages.find(
      (p) => p.pkgStartDate.toDateString() === parsedPackageStartDate.toDateString(),
    );

    if (!pkg) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found for the given start date");
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
    const weekEnd = addDays(weekStart, 6);
    const scheduledClasses = await ScheduledClass.find({
      coachId: coachDocId,
      startTime: { $gte: weekStart, $lte: weekEnd }
    }).sort({ startTime: 1 });

    const packages = await Package.find({ coachId: coachDocId });
    const ptPkgIds = packages.map(p => p._id);

    const sessionsMap = new Map<string, any[]>();

    for (const scheduledClass of scheduledClasses) {
      const cls = await Class.findById(scheduledClass.cid);
      if (!cls) continue;

      const clients = [];
      for (const entry of scheduledClass.bookedMembers) {
        const member = await Member.findOne({ uid: entry.uid }).populate<{ uid: any }>("uid");
        if (!member || !member.uid) continue;

        const activePtPackage = member.packages.find(p =>
          ptPkgIds.some(id => id.equals(p.pkgId)) && p.status === "ACTIVE"
        );

        clients.push({
          memberId: entry.uid.toString(),
          name: member.uid.name ?? "",
          phoneNumber: member.uid.phoneNumber ?? "",
          bookingMethod: entry.method,
          activePackage: activePtPackage ? {
            pkgId: activePtPackage.pkgId.toString(),
            pkgStartDate: activePtPackage.pkgStartDate.toISOString(),
            remainingClasses: activePtPackage.remainingClasses
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
