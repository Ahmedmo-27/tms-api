import { Types } from "mongoose";
import ScheduledClass from "../models/scheduledClass";
import Member from "../models/member";
import Package from "../models/package";
import DeductionLog from "../models/deductionLog";
import Class from "../models/class";
import Coach, { ICoach } from "../models/coach";
import DailyAttendance from "../models/dailyAttendance";
import CoachNotification from "../models/coachNotification";
import Ticket from "../models/ticket";
import User from "../models/user";
import Location from "../models/location";
import { BadRequestError, ForbiddenError, NotFoundError } from "../core/ApiError";
import {
  ClientResponseDto,
  PaginatedClientsResponseDto,
  DeductSessionRequestDto,
  DeductSessionResponseDto,
  MemberPackageResponseDto,
  ScheduleResponseDto,
  CoachMeDto,
  TodaySummaryDto,
  TodaySessionSummaryDto,
  TodayPtAlertDto,
  CoachNotificationDto,
  DeductionHistoryItemDto,
  mapDeductSessionResponseDto,
  mapMemberPackageResponseDto,
} from "../dtos/coach.dto";
import { runInTransaction } from "../utils/transaction";
import { addDays, format, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { CAIRO_TZ, cairoDateKey, isSameCairoDay } from "../utils/timezone";

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
    options?: { page?: number; limit?: number; search?: string; filter?: string; type?: string }
  ): Promise<PaginatedClientsResponseDto> {
    const clientsMap = new Map<string, ClientResponseDto>();
    const ptOnly = options?.type === "PT";

    // Source 1: PT clients
    const ptPackages = await Package.find({ coachId: coachDocId });
    const ptPkgIds = ptPackages.map(p => p._id);
    const ptMembers = await Member.find({ "packages.pkgId": { $in: ptPkgIds } }).populate<{ uid: any }>({
      path: "uid",
      select: "-password -tokens -resetCode -fcmTokens",
    });

    // Source 2: Group session clients (skipped when PT-only is requested)
    const groupMembers: typeof ptMembers = [];
    if (!ptOnly) {
      const classes = await ScheduledClass.find({ coachId: coachDocId });
      const groupUidSet = new Set<string>();
      for (const cls of classes) {
        for (const booking of cls.bookedMembers) {
          groupUidSet.add(booking.uid.toString());
        }
      }
      const groupUids = Array.from(groupUidSet).map((id) => new Types.ObjectId(id));
      if (groupUids.length > 0) {
        const batch = await Member.find({ uid: { $in: groupUids } }).populate<{ uid: any }>({
          path: "uid",
          select: "-password -tokens -resetCode -fcmTokens",
        });
        for (const member of batch) {
          if (member && member.uid) groupMembers.push(member);
        }
      }
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

    // When PT-only mode, strip any client that isn't solely PT-sourced
    if (ptOnly) {
      allClients = allClients.filter(c => c.source.includes("PT"));
    }

    // Exclude clients with 0 active packages
    allClients = allClients.filter(c => c.activePackagesCount > 0);

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
    const packageNameMap = new Map<string, string>();
    const packageSessionsMap = new Map<string, number>();

    for (const pkg of packagesInfo) {
      if (!pkg.coachId || pkg.coachId.toString() === coachDocId.toString()) {
        allowedPkgIdSet.add(pkg._id.toString());
        packageCategoryMap.set(pkg._id.toString(), pkg.category);
        packageNameMap.set(pkg._id.toString(), pkg.name);
        packageSessionsMap.set(pkg._id.toString(), pkg.numberOfSessions);
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
      const pkgName = packageNameMap.get(pkg.pkgId.toString());
      return { 
        ...dto, 
        name: pkgName || dto.name, 
        isPtPackage: category === "PERSONAL_TRAINING",
        totalClasses: packageSessionsMap.get(pkg.pkgId.toString()),
      };
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
    const { memberId, memberPackageStartDate, reason, sessionDate } = dto;

    // --- 1. Validate required fields (Req 7.1) ---
    if (!memberId || !memberPackageStartDate || !reason || !sessionDate) {
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

    // Match by Africa/Cairo calendar day (avoids UTC toDateString off-by-one).
    const pkg = member.packages.find((p) =>
      isSameCairoDay(p.pkgStartDate, parsedPackageStartDate),
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

      const dateStr = formatInTimeZone(scheduledClass.startTime, "Africa/Cairo", "yyyy-MM-dd");
      const sessionDto = {
        scheduledClassId: (scheduledClass._id as Types.ObjectId).toString(),
        classTitle: cls.title,
        category: cls.category,
        startTime: formatInTimeZone(scheduledClass.startTime, "Africa/Cairo", "HH:mm"),
        endTime: formatInTimeZone(scheduledClass.endTime, "Africa/Cairo", "HH:mm"),
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

  /**
   * GET /api/coach/scans?date=YYYY-MM-DD
   * Returns all of the coach's scheduled classes for the given calendar day,
   * each with its full scan list (member name, phone, time, method, status).
   */
  static async getScans(coachDocId: Types.ObjectId, date: Date): Promise<any[]> {
    // Build a [start-of-day, start-of-next-day) window in UTC
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd   = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));

    const scheduledClasses = await ScheduledClass.find({
      coachId: coachDocId,
      startTime: { $gte: dayStart, $lt: dayEnd },
    })
      .populate<{ "scans.uid": any }>("scans.uid")
      .sort({ startTime: 1 });

    const result = [];

    for (const sc of scheduledClasses) {
      const cls = await Class.findById(sc.cid);
      if (!cls) continue;

      // Build scan entries — uid is populated as a User document
      const scans = sc.scans.map((scan: any) => {
        const user = scan.uid as any; // populated User
        return {
          memberId: user?._id?.toString() ?? "",
          member: user?.name ?? "Unknown",
          phone:  user?.phoneNumber ?? "",
          time:   scan.scanTime.toISOString(),
          method: scan.method ?? "",
          status: scan.status ? "SUCCESS" : "FAILED",
        };
      });

      result.push({
        scheduledClassId: (sc._id as Types.ObjectId).toString(),
        classTitle:  cls.title,
        category:    cls.category,
        startTime:   formatInTimeZone(sc.startTime, "Africa/Cairo", "HH:mm"),
        endTime:     formatInTimeZone(sc.endTime,   "Africa/Cairo", "HH:mm"),
        capacity:    sc.availableSlots + sc.bookedMembers.length,
        bookedCount: sc.bookedMembers.length,
        scans,
      });
    }

    return result;
  }

  /**
   * GET /api/coach/pt-attendance?date=YYYY-MM-DD
   * Returns the PT check-in entries for the given date that belong to the
   * authenticated coach (identified by their PT package names).
   * Does NOT return the coach/package name — only member identity and status.
   */
  static async getPtAttendance(coachDocId: Types.ObjectId, date: Date): Promise<any[]> {
    // 1. Collect all PT package names assigned to this coach
    const ptPackages = await Package.find({
      coachId: coachDocId,
      category: "PERSONAL_TRAINING",
    });
    const coachPkgNames = new Set(ptPackages.map((p) => p.name));

    if (coachPkgNames.size === 0) return [];

    // 2. Find the DailyAttendance document for the requested date
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    const attendance = await DailyAttendance.findOne({ date: dayStart }).populate<{
      "ptAttendance.uid": any;
    }>("ptAttendance.uid");

    if (!attendance) return [];

    // 3. Filter ptAttendance entries by coach package names and map to response
    const result: any[] = [];
    for (const entry of attendance.ptAttendance) {
      if (!coachPkgNames.has(entry.method)) continue;
      const user = entry.uid as any; // populated User
      result.push({
        memberId: user?._id?.toString() ?? "",
        member: user?.name ?? "Unknown",
        phone:  user?.phoneNumber ?? "",
        time:   entry.time.toISOString(),
        method: entry.method,
        status: entry.status, // "SUCCESS" | "FAILED"
      });
    }

    return result;
  }

  static async getMe(
    coachUserId: Types.ObjectId,
    coachDocId: Types.ObjectId,
  ): Promise<CoachMeDto> {
    const user = await User.findById(coachUserId).select(
      "name email phoneNumber locationId",
    );
    if (!user) {
      throw new NotFoundError("USER_NOT_FOUND", "Coach user not found");
    }

    let branchName: string | null = null;
    let branchLocation: string | null = null;
    if (user.locationId) {
      const location = await Location.findById(user.locationId);
      if (location) {
        branchName = location.branchName;
        branchLocation = location.location;
      }
    }

    const [ptCount, classCount] = await Promise.all([
      Package.countDocuments({ coachId: coachDocId }),
      ScheduledClass.countDocuments({ coachId: coachDocId }),
    ]);

    return {
      name: user.name ?? "",
      email: user.email ?? "",
      phoneNumber: user.phoneNumber ?? "",
      branchName,
      branchLocation,
      hasPtSessions: ptCount > 0,
      hasScheduledClasses: classCount > 0,
    };
  }

  static async getToday(
    coachDocId: Types.ObjectId,
    coachUserId: Types.ObjectId,
  ): Promise<TodaySummaryDto> {
    const todayKey = cairoDateKey(new Date());
    const cairoNow = toZonedTime(new Date(), CAIRO_TZ);
    const monday = startOfWeek(cairoNow, { weekStartsOn: 1 });
    const weekStart = new Date(`${format(monday, "yyyy-MM-dd")}T00:00:00.000Z`);
    const todayUtc = new Date(`${todayKey}T00:00:00.000Z`);

    const [schedule, scans, ptScans, openTicketCount, unreadNotifications, ptAlerts] =
      await Promise.all([
        this.getSchedule(coachDocId, weekStart),
        this.getScans(coachDocId, todayUtc),
        this.getPtAttendance(coachDocId, todayUtc),
        Ticket.countDocuments({
          createdBy: coachUserId,
          status: { $in: ["pending", "in_progress"] },
        }),
        CoachNotification.countDocuments({ coachId: coachDocId, read: false }),
        this.getPtAlerts(coachDocId),
      ]);

    const toSummary = (
      session: {
        scheduledClassId: string;
        classTitle: string;
        category: string;
        startTime: string;
        endTime: string;
        capacity: number;
        bookedCount: number;
      },
      date: string,
    ): TodaySessionSummaryDto => ({
      scheduledClassId: session.scheduledClassId,
      classTitle: session.classTitle,
      category: session.category,
      date,
      startTime: session.startTime,
      endTime: session.endTime,
      capacity: session.capacity,
      bookedCount: session.bookedCount,
    });

    const todaySessions = (schedule.days.find((d) => d.date === todayKey)?.sessions ?? []).map(
      (s) => toSummary(s, todayKey),
    );

    let nextSession: TodaySessionSummaryDto | null = null;
    const now = new Date();
    for (const day of schedule.days) {
      for (const session of day.sessions) {
        const start = fromZonedTime(`${day.date} ${session.startTime}:00`, CAIRO_TZ);
        if (start > now) {
          nextSession = toSummary(session, day.date);
          break;
        }
      }
      if (nextSession) break;
    }

    const allScans = [
      ...scans.flatMap((cls: { scans: { status: string }[] }) => cls.scans),
      ...ptScans,
    ];

    return {
      nextSession,
      todaySessions,
      scans: {
        successCount: allScans.filter((s) => s.status === "SUCCESS").length,
        failedCount: allScans.filter((s) => s.status === "FAILED").length,
        willPayCount: allScans.filter((s) => s.status === "WILL_PAY").length,
      },
      tickets: { openCount: openTicketCount },
      ptAlerts,
      unreadNotifications,
    };
  }

  private static async getPtAlerts(
    coachDocId: Types.ObjectId,
  ): Promise<TodayPtAlertDto[]> {
    const ptPackages = await Package.find({
      coachId: coachDocId,
      category: "PERSONAL_TRAINING",
    });
    if (ptPackages.length === 0) return [];

    const pkgMap = new Map(ptPackages.map((p) => [p._id.toString(), p]));
    const members = await Member.find({
      "packages.pkgId": { $in: ptPackages.map((p) => p._id) },
    }).populate<{ uid: any }>({
      path: "uid",
      select: "name",
    });

    const now = Date.now();
    const alerts: TodayPtAlertDto[] = [];

    for (const member of members) {
      if (!member.uid) continue;
      for (const pkg of member.packages) {
        const catalog = pkgMap.get(pkg.pkgId.toString());
        if (!catalog || pkg.status !== "ACTIVE") continue;
        if (pkg.pkgEndDate.getTime() < now) continue;
        const daysUntilExpiry = Math.ceil((pkg.pkgEndDate.getTime() - now) / 86400000);
        if (pkg.remainingClasses > 2 && daysUntilExpiry > 14) continue;
        alerts.push({
          memberId: member.uid._id.toString(),
          name: member.uid.name ?? "",
          remainingClasses: pkg.remainingClasses,
          daysUntilExpiry,
          packageName: catalog.name || pkg.name,
        });
      }
    }

    return alerts.slice(0, 10);
  }

  static async getNotifications(
    coachDocId: Types.ObjectId,
  ): Promise<CoachNotificationDto[]> {
    const items = await CoachNotification.find({ coachId: coachDocId })
      .sort({ createdAt: -1 })
      .limit(50);

    return items.map((n) => ({
      id: (n._id as Types.ObjectId).toString(),
      memberId: n.memberId.toString(),
      memberName: n.memberName,
      packageName: n.packageName,
      classesTotal: n.classesTotal,
      createdAt: n.createdAt.toISOString(),
      read: n.read,
    }));
  }

  static async markAllNotificationsRead(coachDocId: Types.ObjectId): Promise<void> {
    await CoachNotification.updateMany(
      { coachId: coachDocId, read: false },
      { $set: { read: true } },
    );
  }

  static async getDeductionHistory(
    coachDocId: Types.ObjectId,
    memberId: string,
  ): Promise<DeductionHistoryItemDto[]> {
    await this.getMemberPackages(coachDocId, memberId);

    const logs = await DeductionLog.find({
      coachId: coachDocId,
      memberId: new Types.ObjectId(memberId),
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return logs.map((log) => ({
      id: (log._id as Types.ObjectId).toString(),
      reason: log.reason,
      sessionDate: log.sessionDate.toISOString(),
      classesRemainingAfter: log.classesRemainingAfter,
      createdAt: log.createdAt.toISOString(),
      pkgId: log.pkgId?.toString(),
    }));
  }
}
