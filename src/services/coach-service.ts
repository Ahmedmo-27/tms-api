import { Types } from "mongoose";
import ScheduledClass from "../models/scheduledClass";
import Member from "../models/member";
import Package from "../models/package";
import DeductionLog from "../models/deductionLog";
import { BadRequestError, ForbiddenError, NotFoundError } from "../core/ApiError";
import {
  ClientResponseDto,
  DeductSessionRequestDto,
  DeductSessionResponseDto,
  MemberPackageResponseDto,
  mapDeductSessionResponseDto,
  mapMemberPackageResponseDto,
} from "../dtos/coach.dto";
import { runInTransaction } from "../utils/transaction";

export class CoachService {
  /**
   * Returns the deduplicated list of members who have been booked into any
   * ScheduledClass assigned to the given coach.
   *
   * Requirements: 5.1, 5.2, 5.3, 5.4
   */
  static async getClients(coachId: Types.ObjectId): Promise<ClientResponseDto[]> {
    // Fetch all scheduled classes for this coach
    const classes = await ScheduledClass.find({ coachId });

    if (!classes || classes.length === 0) {
      return [];
    }

    // Collect distinct member UIDs using a Set to deduplicate
    const uidSet = new Set<string>();
    for (const cls of classes) {
      for (const booking of cls.bookedMembers) {
        uidSet.add(booking.uid.toString());
      }
    }

    if (uidSet.size === 0) {
      return [];
    }

    // For each distinct UID, look up the Member and populate the User ref
    const clients: ClientResponseDto[] = [];

    for (const uidStr of uidSet) {
      const member = await Member.findOne({ uid: new Types.ObjectId(uidStr) }).populate<{
        uid: { _id: Types.ObjectId; name: string; email: string; phoneNumber: string };
      }>("uid");

      if (!member || !member.uid) {
        continue;
      }

      const user = member.uid as any;
      clients.push({
        memberId: uidStr,
        name: user.name ?? "",
        email: user.email ?? "",
        phoneNumber: user.phoneNumber ?? "",
      });
    }

    return clients;
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
    coachId: Types.ObjectId,
    memberId: string,
  ): Promise<MemberPackageResponseDto[]> {
    // Verify Authorization_Link — at least one ScheduledClass must link this
    // coach to the requested member.
    const link = await ScheduledClass.findOne({
      coachId,
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
    const coachPackages = await Package.find({ coachId: coachId });
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
    coachId: Types.ObjectId,
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
      coachId,
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
        coachId,
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
}
