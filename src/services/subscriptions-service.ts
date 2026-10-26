import Member, { IMemberPackageData } from "../models/member";
import Package, { getPackageEndDate, isUnlimitedSpaceAccess } from "../models/package";
import DailyAttendance from "../models/dailyAttendance";
import ScheduledClass from "../models/scheduledClass";
import Class from "../models/class";
import { format } from "date-fns";
import PromoCode from "../models/promoCode";
import { Types } from "mongoose";
import { PaymentsService } from "./payments-service";
import { CoachService } from "./coach-service";
import { sendPtPackageRenewalCoachEmail } from "./email-service";
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { ClientSession } from "mongoose";
import logger from "../config/logger";
import NonUserPackage from "../models/nonUserPackage";
import { cleanUpDeprecatedPackages } from "./package-deletion-guard";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
import { IClassRestrictionRecord } from "../models/member";
import { ChallengeService } from "./challenge-service";
import User from "../models/user";
import { Server as SocketIOServer } from "socket.io";
import { resolveOpenGymPaymentNote } from "../utils/open-gym-payment-purpose";
import { normalizePhoneNumber } from "../utils/phone";
import {
  cairoDayRange,
  startOfDateCairo,
  endOfDateCairo,
  toStoredPackageDate,
} from "../utils/timezone";
import CoachNotification from "../models/coachNotification";
import {
  ensureMemberForPendingPurchase,
  isPendingMember,
} from "../utils/matcha-branch";
import { resolveAppPackageLocationId } from "../utils/app-package-location";
import Payment from "../models/payment";
import {
  isCoacheraOnlinePackage,
  notifyCoacheraOfPurchase,
} from "./coachera-service";

export interface PreviousSessionInputRecord {
  date: string;
  classId?: string;
  className?: string;
  scid?: string;
}

export type PreviousSessionInput = string | PreviousSessionInputRecord;
import { SalesService } from "./sales-service";

export class SubscriptionsService {
  static normalizePreviousSessionInputs(
    inputs: unknown,
  ): PreviousSessionInputRecord[] {
    if (!Array.isArray(inputs)) return [];
    const normalized: PreviousSessionInputRecord[] = [];
    for (const item of inputs) {
      if (!item) continue;
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) {
          normalized.push({ date: trimmed });
        }
      } else if (typeof item === "object") {
        const rawDate = String((item as any).date || "").trim();
        if (rawDate) {
          normalized.push({
            date: rawDate,
            classId: (item as any).classId ? String((item as any).classId).trim() : undefined,
            className: (item as any).className ? String((item as any).className).trim() : undefined,
            scid: (item as any).scid ? String((item as any).scid).trim() : undefined,
          });
        }
      }
    }
    return normalized;
  }

  static async recordSinglePreviousSessionAttendance({
    uid,
    packageDoc,
    pkgStartDate,
    item,
    reason,
    targetLocationId,
    session,
    io,
  }: {
    uid: string;
    packageDoc: any;
    pkgStartDate: Date | string;
    item: PreviousSessionInputRecord;
    reason?: string;
    targetLocationId?: string;
    session: ClientSession;
    io?: any;
  }): Promise<void> {
    const pastDate = toStoredPackageDate(item.date);
    const isPtPackage =
      packageDoc.category === "PERSONAL_TRAINING" || Boolean(packageDoc.coachId);
    const opensClasses = packageDoc.opensClasses || [];
    const hasClasses = Array.isArray(opensClasses) && opensClasses.length > 0;

    if (hasClasses) {
      let resolvedClassId = item.classId;
      if (!resolvedClassId && item.scid) {
        const scls = await ScheduledClass.findById(item.scid).session(session);
        if (scls?.cid) {
          resolvedClassId = scls.cid.toString();
        }
      }
      if (!resolvedClassId && opensClasses.length > 0) {
        const first = opensClasses[0];
        resolvedClassId = (first?._id || first).toString();
      }

      let resolvedClassName = item.className;
      if (!resolvedClassName && resolvedClassId) {
        const cDoc = await Class.findById(resolvedClassId).session(session);
        if (cDoc?.title) {
          resolvedClassName = cDoc.title;
        }
      }
      const finalClassName = resolvedClassName || packageDoc.name;

      let scheduledClass: any = null;
      if (item.scid) {
        scheduledClass = await ScheduledClass.findById(item.scid).session(session);
      }
      if (!scheduledClass && resolvedClassId) {
        const startOfDay = startOfDateCairo(pastDate);
        const endOfDay = endOfDateCairo(pastDate);
        scheduledClass = await ScheduledClass.findOne({
          cid: new Types.ObjectId(resolvedClassId),
          startTime: { $gte: startOfDay, $lte: endOfDay },
          ...(targetLocationId ? { locationId: new Types.ObjectId(targetLocationId) } : {}),
        }).session(session);

        if (!scheduledClass) {
          const startTime = new Date(pastDate);
          if (startTime.getUTCHours() === 0 && startTime.getUTCMinutes() === 0) {
            startTime.setUTCHours(8, 0, 0, 0);
          }
          const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
          scheduledClass = new ScheduledClass({
            cid: new Types.ObjectId(resolvedClassId),
            locationId: targetLocationId ? new Types.ObjectId(targetLocationId) : undefined,
            startTime,
            endTime,
            availableSlots: 20,
            bookedMembers: [],
            scans: [],
          });
          await scheduledClass.save({ session });
        }
      }

      if (scheduledClass) {
        await ScheduledClass.updateOne(
          {
            _id: scheduledClass._id,
            "bookedMembers.uid": { $ne: new Types.ObjectId(uid) },
          },
          {
            $push: {
              bookedMembers: {
                uid: new Types.ObjectId(uid),
                method: packageDoc.name,
                bookingTime: pastDate,
              },
            },
          },
          { session }
        );

        await ScheduledClass.updateOne(
          {
            _id: scheduledClass._id,
            "scans.uid": { $ne: new Types.ObjectId(uid) },
          },
          {
            $push: {
              scans: {
                uid: new Types.ObjectId(uid),
                scanTime: pastDate,
                method: packageDoc.name,
                status: true,
              },
            },
          },
          { session }
        );

        await Member.updateOne(
          {
            uid: new Types.ObjectId(uid),
            "bookings.scid": { $ne: scheduledClass._id },
          },
          {
            $push: {
              bookings: {
                scid: scheduledClass._id,
                cid: new Types.ObjectId(resolvedClassId),
                isDropIn: false,
                bookingTime: pastDate,
              },
            },
          },
          { session }
        );

        await Member.updateOne(
          {
            uid: new Types.ObjectId(uid),
            "attendance.scid": { $ne: scheduledClass._id },
          },
          {
            $push: {
              attendance: {
                scid: scheduledClass._id,
                date: pastDate,
              },
            },
          },
          { session }
        );
      }

      await Member.pushAdjustmentRecord(
        uid,
        packageDoc._id.toString(),
        new Date(pkgStartDate),
        {
          date: new Date(),
          attendanceDate: pastDate,
          source: "ADMIN",
          type: "DEDUCT",
          amount: 1,
          className: finalClassName,
          reason:
            reason?.trim() ||
            `Previous session: ${finalClassName} (${format(pastDate, "dd-MM-yyyy")})`,
        },
        session
      );
    } else if (isPtPackage) {
      await Member.updateOne(
        { uid: new Types.ObjectId(uid) },
        {
          $addToSet: {
            ptAttendance: {
              pkgId: new Types.ObjectId(packageDoc._id),
              date: format(pastDate, "yyyy-MM-dd"),
              attendanceTime: pastDate,
            },
          },
        },
        { session }
      );

      await DailyAttendance.recordPtAttendance(
        uid,
        packageDoc.name,
        session,
        "SUCCESS",
        io,
        (packageDoc as any).locationId?.toString() || targetLocationId,
        packageDoc.coachId ? packageDoc.coachId.toString() : undefined,
        pastDate,
        packageDoc._id.toString()
      );

      await Member.pushAdjustmentRecord(
        uid,
        packageDoc._id.toString(),
        new Date(pkgStartDate),
        {
          date: new Date(),
          attendanceDate: pastDate,
          source: "ADMIN",
          type: "DEDUCT",
          amount: 1,
          className: packageDoc.name,
          reason:
            reason?.trim() ||
            `Previous session: ${format(pastDate, "dd-MM-yyyy")}`,
        },
        session
      );
    } else {
      try {
        await DailyAttendance.recordOpenGymAttendance(
          uid,
          packageDoc.name,
          session,
          "SUCCESS",
          io,
          (packageDoc as any).locationId?.toString() || targetLocationId,
          pastDate,
          packageDoc._id.toString()
        );
      } catch (err: any) {
        if (err?.code === "ATTENDANCE_ALREADY_RECORDED" || (err instanceof ConflictError && (err as any).code === "ATTENDANCE_ALREADY_RECORDED")) {
          // Already recorded for this date, ignore duplicate error
        } else {
          throw err;
        }
      }

      await Member.pushAdjustmentRecord(
        uid,
        packageDoc._id.toString(),
        new Date(pkgStartDate),
        {
          date: new Date(),
          attendanceDate: pastDate,
          source: "ADMIN",
          type: "DEDUCT",
          amount: 1,
          className: packageDoc.name,
          reason:
            reason?.trim() ||
            `Previous session: ${format(pastDate, "dd-MM-yyyy")}`,
        },
        session
      );
    }
  }

  /** Same catalog package + Cairo start day already on the member. */
  static async assertNoDuplicateMemberPackage(
    uid: string,
    pkgId: string,
    startDate: string,
    session?: ClientSession | null,
  ) {
    const exists = await Member.hasPackageOnStartDay(
      uid,
      pkgId,
      startDate,
      session,
    );
    if (exists) {
      const pkg = await Package.findById(pkgId);
      const pkgName = pkg?.name ? ` "${pkg.name}"` : "";
      throw new ConflictError(
        "PACKAGE_ALREADY_ADDED",
        `This member already has an active package${pkgName} starting on this date`,
        {
          uid,
          pkgId,
          startDate,
        },
      );
    }
  }

  /** Unused staged NonUserPackage already exists for phone + package + Cairo start day. */
  static async assertNoDuplicateNonUserPackage(
    phoneNumber: string,
    pkgId: string,
    startDate: string,
    session?: ClientSession | null,
  ) {
    const cleanPhone = normalizePhoneNumber(phoneNumber);
    const { start, end } = cairoDayRange(startDate);
    const existingQuery = NonUserPackage.findOne({
      phoneNumber: cleanPhone,
      pkgId: new Types.ObjectId(pkgId),
      added: false,
      pkgStartDate: { $gte: start, $lt: end },
    });
    if (session) existingQuery.session(session);
    const existing = await existingQuery;
    if (existing) {
      const pkg = await Package.findById(pkgId);
      const pkgName = pkg?.name ? ` "${pkg.name}"` : "";
      throw new ConflictError(
        "PACKAGE_ALREADY_ADDED",
        `A pending package${pkgName} has already been added for ${cleanPhone} on this date`,
        {
          phoneNumber: cleanPhone,
          pkgId,
          startDate,
          nonUserPackageId: String(existing._id),
        },
      );
    }
  }

  /**
   * Determines whether this package subscription is a PT package renewal.
   * Returns true when:
   * 1. The package is in the PERSONAL_TRAINING category (or has a coachId assigned).
   * 2. The member already has (or had) a non-deleted package record:
   *    - With this exact package ID, OR
   *    - Assigned to this same coach.
   */
  static async isPtPackageRenewal(
    memberPackages: IMemberPackageData[] | undefined,
    pkg: { _id?: any; category?: string; coachId?: any }
  ): Promise<boolean> {
    if (!memberPackages || memberPackages.length === 0) return false;

    const isPt = pkg.category === "PERSONAL_TRAINING" || Boolean(pkg.coachId);
    if (!isPt) return false;

    const pkgIdStr = pkg._id ? pkg._id.toString() : "";

    // 1. Direct package match: member previously subscribed to this exact package
    const hasExactPackage = memberPackages.some(
      (p) => p.status !== "DELETED" && p.pkgId && p.pkgId.toString() === pkgIdStr
    );
    if (hasExactPackage) return true;

    // 2. Coach match: member previously had any package belonging to this coach
    if (pkg.coachId) {
      const coachPackages = await Package.find({ coachId: pkg.coachId })
        .select("_id")
        .lean();
      const coachPkgIdSet = new Set(coachPackages.map((p) => p._id.toString()));
      if (pkgIdStr) coachPkgIdSet.add(pkgIdStr);

      const hasCoachPackage = memberPackages.some(
        (p) =>
          p.status !== "DELETED" &&
          p.pkgId &&
          coachPkgIdSet.has(p.pkgId.toString())
      );
      if (hasCoachPackage) return true;
    }

    return false;
  }

  /**
   * Dispatches an email notification to the coach informing them that their client
   * has renewed their Personal Training package.
   * Best-effort: caught and logged without affecting the calling process.
   */
  static async notifyCoachOfPtRenewal(params: {
    coachId: Types.ObjectId | string;
    memberId: Types.ObjectId | string;
    memberName?: string;
    memberPhone?: string;
    packageName: string;
    sessionCount: number;
    startDate: string | Date;
  }): Promise<void> {
    try {
      let { memberName, memberPhone } = params;
      if (!memberName || !memberPhone) {
        const memberUser = await User.findById(params.memberId)
          .select("name phoneNumber")
          .lean();
        if (memberUser) {
          if (!memberName) memberName = memberUser.name;
          if (!memberPhone) memberPhone = memberUser.phoneNumber;
        }
      }

      const coachInfo = await CoachService.getCoachContactInfo(params.coachId);
      if (!coachInfo || !coachInfo.email) {
        logger.warn(
          "Coach renewal notification skipped — coach email not found or unconfigured",
          {
            coachId: String(params.coachId),
            coachName: coachInfo?.coachName,
            memberId: String(params.memberId),
          }
        );
        return;
      }

      await sendPtPackageRenewalCoachEmail({
        coachEmail: coachInfo.email,
        coachName: coachInfo.coachName,
        memberName: memberName || "Member",
        memberPhone: memberPhone || undefined,
        packageName: params.packageName,
        sessionCount: params.sessionCount,
        startDate: params.startDate,
      });
    } catch (err) {
      logger.error("Unexpected error in notifyCoachOfPtRenewal", {
        coachId: String(params.coachId),
        error: (err as Error).message,
      });
    }
  }

  static async frontDeskSubscribeToPackage(
    uid: string,
    pkgId: string,
    startDate: string,
    paymentMethod: string,
    paymentDate?: string,
    amount?: number,
    note?: string,
    io?: SocketIOServer,
    locationId?: string,
    pendingDeduction = false,
    previousSessionDates?: Array<string | PreviousSessionInputRecord>,
    soldBy?: string | null,
  ) {
    if (!uid) {
      throw new BadRequestError("MEMBER_ID_REQUIRED", "Member ID is required");
    }
    if (!pkgId) {
      throw new BadRequestError("PACKAGE_ID_REQUIRED", "Package ID is required");
    }
    if (!startDate) {
      throw new BadRequestError("START_DATE_REQUIRED", "Start date is required");
    }
    if (!paymentMethod) {
      throw new BadRequestError(
        "PAYMENT_METHOD_REQUIRED",
        "Payment method is required",
      );
    }
    if (amount !== undefined && (Number.isNaN(Number(amount)) || Number(amount) < 0)) {
      throw new BadRequestError(
        "INVALID_AMOUNT",
        "Payment amount must be a non-negative number",
      );
    }

    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });
    if (pkg.isDeprecated) {
      throw new BadRequestError(
        "PACKAGE_DEPRECATED",
        "This package has been deprecated and cannot be subscribed to",
      );
    }
    if (
      pkg.category === "OPEN_GYM" &&
      pkg.locationId &&
      locationId &&
      pkg.locationId.toString() !== locationId
    ) {
      throw new BadRequestError(
        "PACKAGE_BRANCH_MISMATCH",
        "This open gym package is not available at the selected branch",
      );
    }

    const normalizedPreviousDates =
      SubscriptionsService.normalizePreviousSessionInputs(previousSessionDates);

    if (normalizedPreviousDates.length > 0) {
      if (normalizedPreviousDates.length > pkg.numberOfSessions) {
        throw new BadRequestError(
          "INVALID_PREVIOUS_SESSIONS",
          `Cannot record more previous sessions (${normalizedPreviousDates.length}) than package total (${pkg.numberOfSessions})`,
        );
      }
      const now = new Date();
      for (const item of normalizedPreviousDates) {
        const parsed = new Date(item.date);
        if (isNaN(parsed.getTime())) {
          throw new BadRequestError(
            "INVALID_DATE",
            `Invalid previous session date: ${item.date}`,
          );
        }
        if (parsed > now) {
          throw new BadRequestError(
            "FUTURE_DATE_NOT_ALLOWED",
            "Previous session dates cannot be in the future",
          );
        }
      }
    } else if (pendingDeduction && pkg.numberOfSessions < 1) {
      throw new BadRequestError(
        "INVALID_DEDUCTION",
        "This package has no sessions to deduct",
      );
    }

    const isRenewal = await SubscriptionsService.isPtPackageRenewal(
      member.packages,
      pkg
    );
    let memberUser: any = null;

    // Persist UTC noon of the Cairo calendar day so naive UTC formatters do not
    // show the previous day (Cairo midnight == previous evening in UTC).
    startDate = toStoredPackageDate(startDate).toISOString();
    if (paymentDate) {
      paymentDate = toStoredPackageDate(paymentDate).toISOString();
    }
    const packageId = new Types.ObjectId(pkgId);
    const endDate = getPackageEndDate(startDate, pkg).toISOString();
    // Sales attribution is optional at the point of sale and can be set or
    // corrected later from the sales dashboard.
    const salesAccountId = await SalesService.resolveSalesAccountId(soldBy);

    let restrictions: IClassRestrictionRecord[];

    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    const resolvedNote =
      note ??
      resolveOpenGymPaymentNote(
        pkg.category,
        pkg.renewalPeriod,
        pkg.name,
        pkg.expiryPeriod,
      );

    let createdPayment: any = null;
    let subscriberUser: any = null;

    await runInTransaction(async (session: ClientSession) => {
      await SubscriptionsService.assertNoDuplicateMemberPackage(
        uid,
        pkg._id.toString(),
        startDate,
        session,
      );
      const user = await User.findOne({ _id: new Types.ObjectId(uid) }).session(
        session,
      );
      if (user) {
        memberUser = { name: user.name, phoneNumber: user.phoneNumber };
      }
      if (user && user.role === "user") {
        user.role = "member";
        await user.save(session ? { session } : {});
      }
      subscriberUser = user;
      if (user?.phoneNumber) {
        await SubscriptionsService.assertNoDuplicateNonUserPackage(
          user.phoneNumber,
          pkg._id.toString(),
          startDate,
          session,
        );
      }
      const resolvedAmount =
        amount !== undefined && amount !== null && String(amount) !== ""
          ? Number(amount)
          : pkg.price;
      const payment = await PaymentsService.savePayment(
        uid,
        resolvedAmount,
        paymentMethod,
        "PACKAGE",
        session,
        undefined,
        undefined,
        undefined,
        packageId,
        paymentDate,
        resolvedNote,
        undefined,
        undefined,
        locationId
      );
      createdPayment = payment;
      const previousDeductCount =
        normalizedPreviousDates.length > 0
          ? normalizedPreviousDates.length
          : pendingDeduction
          ? 1
          : 0;
      const remainingClasses = Math.max(
        0,
        pkg.numberOfSessions - previousDeductCount
      );
      await Member.addPackage(
        uid,
        pkg._id.toString(),
        pkg.name,
        remainingClasses,
        startDate,
        endDate,
        session,
        restrictions,
        locationId,
        salesAccountId ? salesAccountId.toString() : null
      );

      if (remainingClasses === 0 && !isUnlimitedSpaceAccess(pkg.category)) {
        await Member.updateOne(
          {
            uid: new Types.ObjectId(uid),
            "packages.pkgId": pkg._id,
            "packages.pkgStartDate": new Date(startDate),
          },
          { $set: { "packages.$.status": "COMPLETED" } },
          { session }
        );
      }

      if (normalizedPreviousDates.length > 0) {
        for (const item of normalizedPreviousDates) {
          await SubscriptionsService.recordSinglePreviousSessionAttendance({
            uid,
            packageDoc: pkg,
            pkgStartDate: startDate,
            item,
            targetLocationId: locationId || (pkg.locationId ? pkg.locationId.toString() : undefined),
            session,
            io,
          });
        }
      } else if (pendingDeduction) {
        await Member.pushAdjustmentRecord(
          uid,
          pkg._id.toString(),
          new Date(startDate),
          {
            date: new Date(),
            source: "ADMIN",
            type: "DEDUCT",
            amount: 1,
            reason: "Attended a class using this package",
          },
          session,
        );
      }
      if (pkg.coachId) {
        const payload = {
          memberId: uid,
          memberName: user?.name ?? "",
          packageName: pkg.name,
          classesTotal: pkg.numberOfSessions,
          createdAt: new Date().toISOString(),
        };
        await CoachNotification.create(
          [
            {
              coachId: pkg.coachId,
              memberId: new Types.ObjectId(uid),
              memberName: payload.memberName,
              packageName: payload.packageName,
              classesTotal: payload.classesTotal,
              read: false,
            },
          ],
          { session },
        );
        if (io) {
          io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", payload);
        } else {
          logger.warn("coach:newPackage skipped — io instance unavailable");
        }
      }
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
    });

    if (isCoacheraOnlinePackage(pkg) && createdPayment) {
      await notifyCoacheraOfPurchase({
        payment: createdPayment,
        pkg,
        user: subscriberUser,
      });
    }

    if (isRenewal && pkg.coachId) {
      SubscriptionsService.notifyCoachOfPtRenewal({
        coachId: pkg.coachId,
        memberId: uid,
        memberName: memberUser?.name,
        memberPhone: memberUser?.phoneNumber,
        packageName: pkg.name,
        sessionCount: pkg.numberOfSessions,
        startDate,
      }).catch((err) => {
        logger.error("Failed to notify coach of PT renewal", {
          error: err.message,
          uid,
          pkgId,
        });
      });
    }
  }

  static async subscribeToPackage(
    uid: string,
    pkgId: string,
    startDate: string,
    paymentMethod: string,
    merchantReferenceId?: string,
    promoCode?: string,
    note?: string,
    io?: SocketIOServer,
  ) {
    let orderId: string | undefined;
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });
    if (pkg.isDeprecated) {
      throw new BadRequestError(
        "PACKAGE_DEPRECATED",
        "This package has been deprecated and cannot be subscribed to",
      );
    }

    if ((await isPendingMember(uid)) && !isCoacheraOnlinePackage(pkg)) {
      throw new ForbiddenError(
        "MEMBERSHIP_REQUIRED",
        "Packages require membership",
      );
    }

    let member = await Member.findOne({ uid });
    if (!member) {
      await ensureMemberForPendingPurchase(uid);
      member = await Member.findOne({ uid });
    }
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });

    const isRenewal = await SubscriptionsService.isPtPackageRenewal(
      member.packages,
      pkg
    );
    let memberUser: any = null;

    startDate = toStoredPackageDate(startDate).toISOString();
    const packageId = new Types.ObjectId(pkgId);
    const endDate = getPackageEndDate(startDate, pkg).toISOString();

    let restrictions: IClassRestrictionRecord[];
    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    let price = pkg.price;
    if (promoCode) {
      const discountedPrice = await PromoCode.getDiscountedPrice(
        promoCode,
        pkg.price,
        "PACKAGE",
      );
      if (discountedPrice === null)
        throw new NotFoundError("PROMO_CODE_NOT_FOUND", "Promo code not found");
      price = discountedPrice;
    }

    const packageLocationId = await resolveAppPackageLocationId(
      pkg,
      false,
    );

    // Idempotent APP confirm: payment already saved for this merchant ref
    if (merchantReferenceId && paymentMethod === "APP") {
      const existingPayment =
        await PaymentsService.findPaymentByMerchantReference(
          merchantReferenceId,
          "PACKAGE",
        );
      if (existingPayment) {
        const alreadyHasPkg = await Member.hasPackageOnStartDay(
          uid,
          pkg._id.toString(),
          startDate,
        );
        if (alreadyHasPkg) {
          logger.info(
            `Package subscribe idempotent no-op: uid=${uid} pkg=${pkgId} mref=${merchantReferenceId}`,
          );
          return;
        }
        logger.info(
          `Package subscribe idempotent fulfill from payment ${existingPayment._id} mref=${merchantReferenceId}`,
        );
        await runInTransaction(async (session: ClientSession) => {
          const user = await User.findById(uid).session(session);
          if (user) {
            memberUser = { name: user.name, phoneNumber: user.phoneNumber };
          }
          await Member.addPackage(
            uid,
            pkg._id.toString(),
            pkg.name,
            pkg.numberOfSessions,
            startDate,
            endDate,
            session,
            restrictions,
            packageLocationId,
          );
          if (pkg.coachId) {
            const payload = {
              memberId: uid,
              memberName: user?.name ?? "",
              packageName: pkg.name,
              classesTotal: pkg.numberOfSessions,
              createdAt: new Date().toISOString(),
            };
            await CoachNotification.create(
              [
                {
                  coachId: pkg.coachId,
                  memberId: new Types.ObjectId(uid),
                  memberName: payload.memberName,
                  packageName: payload.packageName,
                  classesTotal: payload.classesTotal,
                  read: false,
                },
              ],
              { session },
            );
            if (io) {
              io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", payload);
            }
          }
        });
        if (isRenewal && pkg.coachId) {
          SubscriptionsService.notifyCoachOfPtRenewal({
            coachId: pkg.coachId,
            memberId: uid,
            memberName: memberUser?.name,
            memberPhone: memberUser?.phoneNumber,
            packageName: pkg.name,
            sessionCount: pkg.numberOfSessions,
            startDate,
          }).catch((err) => {
            logger.error("Failed to notify coach of PT renewal (app idempotent)", {
              error: err.message,
              uid,
              pkgId,
            });
          });
        }
        return;
      }

      try {
        orderId = await PaymentsService.checkPayment(
          merchantReferenceId,
          price,
        );
      } catch (err) {
        if (
          err instanceof ConflictError &&
          err.code === "PAYMENT_ALREADY_RECORDED"
        ) {
          const recorded = await PaymentsService.findPaymentByMerchantReference(
            merchantReferenceId,
            "PACKAGE",
          );
          if (recorded) {
            const alreadyHasPkg = await Member.hasPackageOnStartDay(
              uid,
              pkg._id.toString(),
              startDate,
            );
            if (!alreadyHasPkg) {
              await runInTransaction(async (session: ClientSession) => {
                const user = await User.findById(uid).session(session);
                if (user) {
                  memberUser = { name: user.name, phoneNumber: user.phoneNumber };
                }
                await Member.addPackage(
                  uid,
                  pkg._id.toString(),
                  pkg.name,
                  pkg.numberOfSessions,
                  startDate,
                  endDate,
                  session,
                  restrictions,
                  packageLocationId,
                );
                if (pkg.coachId) {
                  const payload = {
                    memberId: uid,
                    memberName: user?.name ?? "",
                    packageName: pkg.name,
                    classesTotal: pkg.numberOfSessions,
                    createdAt: new Date().toISOString(),
                  };
                  await CoachNotification.create(
                    [
                      {
                        coachId: pkg.coachId,
                        memberId: new Types.ObjectId(uid),
                        memberName: payload.memberName,
                        packageName: payload.packageName,
                        classesTotal: payload.classesTotal,
                        read: false,
                      },
                    ],
                    { session },
                  );
                  if (io) {
                    io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", payload);
                  }
                }
              });
              if (isRenewal && pkg.coachId) {
                SubscriptionsService.notifyCoachOfPtRenewal({
                  coachId: pkg.coachId,
                  memberId: uid,
                  memberName: memberUser?.name,
                  memberPhone: memberUser?.phoneNumber,
                  packageName: pkg.name,
                  sessionCount: pkg.numberOfSessions,
                  startDate,
                }).catch((err) => {
                  logger.error("Failed to notify coach of PT renewal (app conflict)", {
                    error: err.message,
                    uid,
                    pkgId,
                  });
                });
              }
            }
            return;
          }
        }
        throw err;
      }
    }

    let createdPayment: any = null;
    let subscriberUser: any = null;

    await runInTransaction(async (session: ClientSession) => {
      await SubscriptionsService.assertNoDuplicateMemberPackage(
        uid,
        pkg._id.toString(),
        startDate,
        session,
      );
      const user = await User.findById(uid).session(session);
      subscriberUser = user;
      if (user) {
        memberUser = { name: user.name, phoneNumber: user.phoneNumber };
      }
      if (user?.phoneNumber) {
        await SubscriptionsService.assertNoDuplicateNonUserPackage(
          user.phoneNumber,
          pkg._id.toString(),
          startDate,
          session,
        );
      }

      // Concurrent confirm may have saved payment already
      if (merchantReferenceId && paymentMethod === "APP") {
        const racePayment = await Payment.findOne({
          merchantReferenceId,
          purpose: "PACKAGE",
          isRefunded: { $ne: true },
        }).session(session);
        if (racePayment) {
          await Member.addPackage(
            uid,
            pkg._id.toString(),
            pkg.name,
            pkg.numberOfSessions,
            startDate,
            endDate,
            session,
            restrictions,
            packageLocationId,
          );
          if (pkg.coachId) {
            const payload = {
              memberId: uid,
              memberName: user?.name ?? "",
              packageName: pkg.name,
              classesTotal: pkg.numberOfSessions,
              createdAt: new Date().toISOString(),
            };
            await CoachNotification.create(
              [
                {
                  coachId: pkg.coachId,
                  memberId: new Types.ObjectId(uid),
                  memberName: payload.memberName,
                  packageName: payload.packageName,
                  classesTotal: payload.classesTotal,
                  read: false,
                },
              ],
              { session },
            );
            if (io) {
              io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", payload);
            }
          }
          return;
        }
      }

      const payment = await PaymentsService.savePayment(
        uid,
        price,
        paymentMethod,
        "PACKAGE",
        session,
        orderId,
        merchantReferenceId,
        undefined,
        packageId,
        undefined,
        undefined,
        undefined,
        undefined,
        packageLocationId,
      );
      createdPayment = payment;
      await Member.addPackage(
        uid,
        pkg._id.toString(),
        pkg.name,
        pkg.numberOfSessions,
        startDate,
        endDate,
        session,
        restrictions,
        packageLocationId,
      );
      if (pkg.coachId) {
        const payload = {
          memberId: uid,
          memberName: user?.name ?? "",
          packageName: pkg.name,
          classesTotal: pkg.numberOfSessions,
          createdAt: new Date().toISOString(),
        };
        await CoachNotification.create(
          [
            {
              coachId: pkg.coachId,
              memberId: new Types.ObjectId(uid),
              memberName: payload.memberName,
              packageName: payload.packageName,
              classesTotal: payload.classesTotal,
              read: false,
            },
          ],
          { session },
        );
        if (io) {
          io.to(`coach:${pkg.coachId.toString()}`).emit("coach:newPackage", payload);
        }
      }
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
    });

    if (isCoacheraOnlinePackage(pkg) && createdPayment) {
      await notifyCoacheraOfPurchase({
        payment: createdPayment,
        pkg,
        user: subscriberUser,
      });
    }

    if (isRenewal && pkg.coachId) {
      SubscriptionsService.notifyCoachOfPtRenewal({
        coachId: pkg.coachId,
        memberId: uid,
        memberName: memberUser?.name,
        memberPhone: memberUser?.phoneNumber,
        packageName: pkg.name,
        sessionCount: pkg.numberOfSessions,
        startDate,
      }).catch((err) => {
        logger.error("Failed to notify coach of PT renewal (app)", {
          error: err.message,
          uid,
          pkgId,
        });
      });
    }
  }

  static async addSavedPkgToMember(
    uid: string,
    pkgId: string,
    startDate: string,
    remainingClasses: number,
    savedEndDate?: string,
    session?: ClientSession,
  ) {
    const member = await Member.findOne({ uid }).session(session ?? null);
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    const pkg = await Package.findById(pkgId).session(session ?? null);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
        pkgId,
      });
    startDate = toStoredPackageDate(startDate).toISOString();
    const endDate = savedEndDate
      ? toStoredPackageDate(savedEndDate).toISOString()
      : getPackageEndDate(startDate, pkg).toISOString();

    let restrictions: IClassRestrictionRecord[];
    if (pkg.classRestrictions) {
      restrictions = [];
      pkg.classRestrictions.forEach((cls) => {
        restrictions.push({
          cid: cls.cid,
          limit: cls.limit,
        });
      });
    }

    const addPackage = async (s: ClientSession) => {
      const added = await Member.addPackageIfAbsent(
        uid,
        pkg._id.toString(),
        pkg.name,
        remainingClasses,
        startDate,
        endDate,
        s,
        restrictions,
        undefined
      );
      if (added) {
        logger.info("Added pkg", { uid, pkgId: pkg._id.toString(), startDate });
      } else {
        logger.info("Skipped duplicate staged package", {
          uid,
          pkgId: pkg._id.toString(),
          startDate,
        });
      }
    };

    if (session) {
      await addPackage(session);
    } else {
      await runInTransaction(addPackage);
    }
  }

  static async unsubscribeFromPackage(
    uid: string,
    pkgId: string,
    pkgStartDate: string,
  ) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
        uid,
      });
    await runInTransaction(async (session: ClientSession) => {
      await Member.removePackage(uid, pkgId, pkgStartDate, session);
    });
    await cleanUpDeprecatedPackages();
  }

  static async transferStagedPackagesToMember(
    uid: string,
    phoneNumber: string,
    session?: ClientSession,
  ) {
    const cleanPhone = normalizePhoneNumber(phoneNumber);
    const pkgQuery = NonUserPackage.find({
      phoneNumber: cleanPhone,
      added: false,
    }).sort({ createdAt: 1 });
    if (session) pkgQuery.session(session);
    const savedPkgs = await pkgQuery;

    // Prefer the first staged record per pkgId + start day; later duplicates are
    // still marked added so accept/register does not fail with PACKAGE_ALREADY_ADDED.
    const seenKeys = new Set<string>();

    for (const savedPkg of savedPkgs) {
      const startDayKey = new Date(savedPkg.pkgStartDate)
        .toISOString()
        .slice(0, 10);
      const dedupeKey = `${savedPkg.pkgId.toString()}:${startDayKey}`;

      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        await SubscriptionsService.addSavedPkgToMember(
          uid,
          savedPkg.pkgId.toString(),
          savedPkg.pkgStartDate.toISOString(),
          savedPkg.remainingClasses,
          savedPkg.pkgEndDate.toISOString(),
          session
        );

        const catalogPkg = await Package.findById(savedPkg.pkgId).session(session || null);
        if (catalogPkg && savedPkg.remainingClasses < catalogPkg.numberOfSessions) {
          const usedClasses = catalogPkg.numberOfSessions - savedPkg.remainingClasses;
          const pushAdjustment = async (s: ClientSession) => {
            await Member.pushAdjustmentRecord(
              uid,
              savedPkg.pkgId.toString(),
              new Date(savedPkg.pkgStartDate),
              {
                date: (savedPkg as any).createdAt || new Date(),
                source: "ADMIN",
                type: "DEDUCT",
                amount: usedClasses,
                reason: "Attended a class using this package",
              },
              s
            );
          };
          if (session) {
            await pushAdjustment(session);
          } else {
            await runInTransaction(pushAdjustment);
          }
        }
      } else {
        logger.info("Skipping duplicate staged NonUserPackage", {
          uid,
          nonUserPackageId: String(savedPkg._id),
          pkgId: savedPkg.pkgId.toString(),
          pkgStartDate: savedPkg.pkgStartDate,
        });
      }

      await NonUserPackage.findByIdAndUpdate(
        savedPkg._id as Types.ObjectId,
        { added: true },
        session ? { session } : {}
      );
    }

    if (savedPkgs.length > 0) {
      await User.findByIdAndUpdate(
        uid,
        { role: "member" },
        session ? { session } : {}
      );
      try {
        const DailyAttendance = (await import("../models/dailyAttendance")).default;
        await DailyAttendance.updateMany(
          { "openGymAttendance.guestPhone": cleanPhone },
          { $set: { "openGymAttendance.$[elem].uid": new Types.ObjectId(uid) } },
          { arrayFilters: [{ "elem.guestPhone": cleanPhone }], ...(session ? { session } : {}) }
        );
        await DailyAttendance.updateMany(
          { "ptAttendance.guestPhone": cleanPhone },
          { $set: { "ptAttendance.$[elem].uid": new Types.ObjectId(uid) } },
          { arrayFilters: [{ "elem.guestPhone": cleanPhone }], ...(session ? { session } : {}) }
        );
      } catch (attendanceErr) {
        logger.warn("Failed to link guest attendance to member:", attendanceErr);
      }
    }
  }

  static async addNonUserPackage(
    name: string,
    phoneNumber: string,
    pkgId: string,
    pkgStartDate: string,
    paymentMethod: string,
    pendingDeduction: boolean,
    paymentDate?: string,
    amount?: string,
    locationId?: string,
    note?: string,
    nationalId?: string,
  ) {
    if (!name || !name.trim()) {
      throw new BadRequestError("NAME_REQUIRED", "Name is required");
    }
    if (!phoneNumber) {
      throw new BadRequestError("PHONE_REQUIRED", "Phone number is required");
    }
    if (!pkgId) {
      throw new BadRequestError("PACKAGE_ID_REQUIRED", "Package ID is required");
    }
    if (!pkgStartDate) {
      throw new BadRequestError("START_DATE_REQUIRED", "Start date is required");
    }
    if (!paymentMethod) {
      throw new BadRequestError("PAYMENT_METHOD_REQUIRED", "Payment method is required");
    }
    if (amount !== undefined && (Number.isNaN(Number(amount)) || Number(amount) < 0)) {
      throw new BadRequestError("INVALID_AMOUNT", "Amount must be a non-negative number");
    }

    name = name.trim();
    phoneNumber = normalizePhoneNumber(phoneNumber);
    const pkg = await Package.findById(pkgId);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "The package was not found");
    if (pkg.isDeprecated) {
      throw new BadRequestError(
        "PACKAGE_DEPRECATED",
        "This package has been deprecated and cannot be subscribed to",
      );
    }
    if (pendingDeduction && pkg.numberOfSessions < 1) {
      throw new BadRequestError(
        "INVALID_DEDUCTION",
        "This package has no sessions to deduct",
      );
    }
    pkgStartDate = toStoredPackageDate(pkgStartDate).toISOString();
    if (paymentDate) {
      paymentDate = toStoredPackageDate(paymentDate).toISOString();
    }
    const endDate = getPackageEndDate(pkgStartDate, pkg).toISOString();
    let createdPayment: any = null;
    let matchedUser: any = null;

    await runInTransaction(async (session: ClientSession) => {
      await SubscriptionsService.assertNoDuplicateNonUserPackage(
        phoneNumber,
        pkgId,
        pkgStartDate,
        session,
      );
      const existingUser = await User.findOne({ phoneNumber }).session(
        session ?? null,
      );
      matchedUser = existingUser;
      if (existingUser) {
        await SubscriptionsService.assertNoDuplicateMemberPackage(
          String(existingUser._id),
          pkgId,
          pkgStartDate,
          session,
        );
        if (nationalId && !existingUser.nationalId) {
          existingUser.nationalId = nationalId;
          await existingUser.save(session ? { session } : {});
        }
      } else {
        const pendingUser = new User({
          name,
          phoneNumber,
          email: "",
          role: "user",
          ...(nationalId ? { nationalId } : {}),
        });
        await pendingUser.save(session ? { session } : {});
        matchedUser = pendingUser;
      }
      const resolvedAmount =
        amount !== undefined && amount !== null && String(amount) !== ""
          ? Number(amount)
          : (pkg as any).price;
      const payment = await PaymentsService.savePayment(
        undefined,
        resolvedAmount,
        paymentMethod,
        "NON_USER_PACKAGE",
        session,
        undefined,
        undefined,
        undefined,
        (pkg as any)._id,
        paymentDate ? paymentDate : undefined,
        note,
        name,
        phoneNumber,
        locationId
      );
      createdPayment = payment;
      logger.info("Payment Created: ", {
        paymentId: payment._id,
        amount: payment.amount,
      });
      const nonUserPackage = new NonUserPackage({
        name,
        pkgId,
        phoneNumber,
        pkgStartDate,
        pkgEndDate: endDate,
        remainingClasses: pendingDeduction
          ? (pkg as any).numberOfSessions - 1
          : (pkg as any).numberOfSessions,
        paymentId: payment._id,
        createdAt: new Date(),
        ...(nationalId ? { nationalId } : {}),
      });
      await nonUserPackage.save(session ? { session } : {});
      if (pkg.category !== "PERSONAL_TRAINING") {
        await sendPaymentToRentalSystem(payment);
      }
    });

    if (isCoacheraOnlinePackage(pkg) && createdPayment) {
      await notifyCoacheraOfPurchase({
        payment: createdPayment,
        pkg,
        user: matchedUser,
        fallbackClient: { name, phone: phoneNumber },
      });
    }
  }
}
