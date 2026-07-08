import { ClientSession, Types } from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import Class from "../models/class";
import Package from "../models/package";
import PromoCode from "../models/promoCode";
import { PaymentsService } from "./payments-service";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { Server } from "http";
import DailyAttendance from "../models/dailyAttendance";
import Location from "../models/location";
import logger from "../config/logger";
import {
  isValidOpenGymLocationId,
  LEGACY_OPEN_GYM_PAYLOAD,
} from "../utils/scan-payload";
import { resolveLegacyOpenGymLocationId } from "../utils/open-gym-location";
import { SCAN_ERROR_MESSAGES } from "../utils/error-messages";
import NonUserBooking, { INonUserBooking } from "../models/nonUserBookings";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
import { NotificationsService } from "./notifications-service";
import { WaitlistService } from "./waitlist-service";
import Reservation from "../models/reservation";
import WaitlistEntry from "../models/waitlistEntry";
import ChallengeRecord from "../models/challengeRecord";
import {
  assertMatchaSessionForPendingUser,
  ensureMemberForPendingPurchase,
  isPendingMember,
} from "../utils/matcha-branch";

export class BookingsService {
  static async addBooking(uid: string, scid: string, isAdminOverride: boolean = false) {
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "cid",
      populate: { path: "locations" },
    }).populate({ path: "locationId" });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");

    const pendingMember = await isPendingMember(uid);
    if (pendingMember) {
      await assertMatchaSessionForPendingUser(scheduledClass);
    }

    let member = await Member.findOne({ uid });
    if (!member) {
      await ensureMemberForPendingPurchase(uid);
      member = await Member.findOne({ uid });
    }
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");

    // Enforce Waitlist Reservations
    if (!isAdminOverride) {
      const activeReservationsCount = await Reservation.countDocuments({
        sessionId: scheduledClass._id,
        status: "ACTIVE"
      });
      const userHasReservation = await Reservation.findOne({
        sessionId: scheduledClass._id,
        userId: new Types.ObjectId(uid),
        status: "ACTIVE"
      });
      
      const publicSlots = scheduledClass.availableSlots - activeReservationsCount;
      if (publicSlots <= 0 && !userHasReservation) {
        const expiredReservation = await Reservation.findOne({
          sessionId: scheduledClass._id,
          userId: new Types.ObjectId(uid),
          status: "EXPIRED"
        });
        if (expiredReservation) {
          throw new ForbiddenError("RESERVATION_EXPIRED", "Your reservation window has expired. The spot has been passed to the next person.");
        }

        const waitingEntry = await WaitlistEntry.findOne({
          sessionId: scheduledClass._id,
          userId: new Types.ObjectId(uid),
          status: "WAITING"
        });
        if (waitingEntry) {
          throw new ForbiddenError("STILL_WAITING", "You are currently on the waitlist. We will notify you when it is your turn.");
        }

        throw new ForbiddenError("SPOT_RESERVED", "Available spots are currently reserved for waitlisted members. Please join the waitlist.");
      }
    }

    // Apply booking policy restriction (30 mins after class start time)
    if (!isAdminOverride && (scheduledClass.cid as any).category !== "WORKSPACE") {
      if (
        new Date() >
        new Date(scheduledClass.startTime.getTime() + 30 * 60 * 1000)
      )
        throw new ConflictError(
          "CLASS_ALREADY_STARTED",
          "Class already started",
        );
    }

    // get location and class specific data
    const scheduledLocation = (scheduledClass as any).locationId;
    const location =
      scheduledLocation?.branchName ??
      scheduledLocation?.location ??
      (scheduledClass as any).cid.locations[0]?.branchName;
    if (!location)
      throw new BadRequestError(
        "LOCATION_REQUIRED",
        "Scheduled class has no location assigned",
      );
    const isFree = (scheduledClass.cid as any).price === 0;
    const isWorkSpace = (scheduledClass.cid as any).category === "WORKSPACE";

    // get monthString to check restrictions record
    const month = scheduledClass.startTime.getMonth() + 1;
    const year = scheduledClass.startTime.getFullYear();
    const monthString = month.toString() + year.toString();

    // get valid packages and check if member has no packages
    const validPkgs: string[] = await Package.getClassPackages(
      scheduledClass.cid._id.toString(),
      location,
    );
    if (!validPkgs || validPkgs.length === 0)
      throw new NotFoundError(
        "NO_ACTIVE_PACKAGE_FOUND",
        "No valid packages found",
      );

    // get class points for deduction
    const points = (scheduledClass as any).cid.points
      ? (scheduledClass as any).cid.points
      : 1;

    // Start booking db transaction
    await runInTransaction(async (session: ClientSession) => {
      // save booking on member doc
      const usedPkgId = await Member.saveBooking(
        uid,
        validPkgs,
        scid,
        isFree,
        isWorkSpace,
        scheduledClass.cid._id.toString(),
        monthString,
        points,
        session,
        (scheduledClass.cid as any).title,
        scheduledClass.startTime,
      );

      // get pkg used for booking
      const pkg = await Package.findById(usedPkgId);
      if (!pkg)
        throw new NotFoundError("PACKAGE_NOT_FOUND", "Invalid package used");

      // add member to scheduled class booked members
      await ScheduledClass.bookMember(scid, uid, pkg.name, session);

      // check if user has challenge record
      const record = await ChallengeRecord.findOne({ uid });

      if (record && record.workoutChallenge) {
        // 🔥 Hardcoded challenge start date (18 Feb 2026)
        const challengeStart = new Date(2026, 1, 18); // Month is 0-indexed
        const classDate = scheduledClass.startTime;

        // Calculate which week this class belongs to
        const diffInDays = Math.floor(
          (classDate.getTime() - challengeStart.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        const weekNumber = Math.floor(diffInDays / 7) + 1;

        if (weekNumber < 1 || weekNumber > 4) {
        } else {
          // Get the week object
          let workoutWeek = record.workoutChallenge.weeks?.find(
            (w) => w.weekNumber === weekNumber,
          );

          // If week does not exist yet, initialize it
          if (!workoutWeek) {
            workoutWeek = {
              weekNumber,
              days: [
                { dayNumber: 1, completed: false },
                { dayNumber: 2, completed: false },
                { dayNumber: 3, completed: false },
                { dayNumber: 4, completed: false },
              ],
              weekComplete: false,
            };
            record.workoutChallenge.weeks.push(workoutWeek);
          }

          // Find the first incomplete day
          const nextDay = workoutWeek.days.find((d) => !d.completed);

          if (nextDay) {
            // Mark it as completed
            nextDay.completed = true;
            nextDay.scid = scheduledClass._id as Types.ObjectId;

            // Check if the week is now complete
            workoutWeek.weekComplete = workoutWeek.days.every(
              (d) => d.completed,
            );

            // Save changes in transaction
            await runInTransaction(async (session: ClientSession) => {
              await ChallengeRecord.updateWorkoutDay(
                uid,
                weekNumber,
                nextDay.dayNumber,
                true,
                (scheduledClass._id as Types.ObjectId).toString(),
                session,
              );
            });
          } else {
          }
        }
      }

      // If user had a reservation, mark it COMPLETED
      const userReservation = await Reservation.findOne({
        sessionId: scheduledClass._id,
        userId: new Types.ObjectId(uid),
        status: "ACTIVE"
      }).session(session);
      
      if (userReservation) {
        userReservation.status = "COMPLETED";
        await userReservation.save({ session });
        await WaitlistEntry.updateOne(
          { sessionId: scheduledClass._id, userId: new Types.ObjectId(uid), status: "NOTIFIED" },
          { status: "BOOKED" },
          { session }
        );
      }
    });
  }

  // Refund policy
  // 3-hours before class
  static async cancelBooking(uid: string, scid: string): Promise<void> {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "cid",
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
    const cancellationDeadline = new Date(
      scheduledClass.startTime.getTime() - 3 * 60 * 60 * 1000,
    );
    if (new Date() > cancellationDeadline)
      throw new ForbiddenError(
        "DEADLINE_PASSED",
        "Must cancel 3 hours before class start time",
      );
    const booking = member.bookings.find((b) => b.scid.toString() === scid);
    if (!booking)
      throw new NotFoundError("BOOKING_NOT_FOUND", "Booking not found");
    const isDeducted =
      (scheduledClass.cid as any).category !== "WORKSPACE" &&
      (scheduledClass.cid as any).price != 0 &&
      !booking.isDropIn;
    const pkgs = await Package.find({ opensClasses: scheduledClass.cid });
    const pkgIds = pkgs.map((p) => p._id.toString());

    // get monthString to check restrictions record
    const month = scheduledClass.startTime.getMonth() + 1;
    const year = scheduledClass.startTime.getFullYear();
    const monthString = month.toString() + year.toString();

    await runInTransaction(async (session: ClientSession) => {
      await Member.removeBooking(
        uid,
        scid,
        pkgIds,
        isDeducted,
        session,
        scheduledClass.cid._id.toString(),
        monthString,
        "MEMBER_CANCELLATION",
        (scheduledClass.cid as any).title,
      );
      const waitingList = await ScheduledClass.removeBookedMember(
        scid,
        uid,
        session,
      );
    });
    
    // Trigger waitlist processing after transaction succeeds
    await WaitlistService.processWaitlist(scid);
  }

  static async cancelDropIn(uid: string, scid: string): Promise<void> {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND,
      );
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError(
        "CLASS_NOT_FOUND",
        SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND,
      );
    const cancellationDeadline = new Date(
      scheduledClass.startTime.getTime() - 3 * 60 * 60 * 1000,
    );
    if (new Date() > cancellationDeadline)
      throw new ForbiddenError(
        "PAST_CANCELLATION_DEADLINE",
        "Must cancel 3 hours before class start time",
      );
    const booking = member.bookings.find((b) => b.scid.toString() === scid);
    const paymentId = booking?.paymentId;
    if (!booking)
      throw new NotFoundError("CLASS_NOT_BOOKED", "Class not booked");
    if (!booking.isDropIn)
      throw new BadRequestError("NOT_A_DROPIN", "Not a dropin booking");
    if (!paymentId)
      throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment not found");
    const classTitle = (scheduledClass as { className?: string }).className;
    const refundReason = classTitle
      ? `Drop-in cancellation: ${classTitle}`
      : "Drop-in cancellation";
    await runInTransaction(async (session: ClientSession) => {
      await PaymentsService.refundPayment(
        paymentId.toString(),
        session,
        refundReason
      );
      await Member.removeBooking(uid, scid, [], false, session);
      const waitingList = await ScheduledClass.removeBookedMember(
        scid,
        uid,
        session,
      );
    });

    // Trigger waitlist processing after transaction succeeds
    await WaitlistService.processWaitlist(scid);
  }

  static async recordAttendance(uid: string, scid: string, io: Server) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND,
      );
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError(
        "CLASS_NOT_FOUND",
        SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND,
      );
    const attendanceDeadline = new Date(
      scheduledClass.startTime.getTime() + 30 * 60 * 1000,
    );
    if (new Date() > attendanceDeadline) {
      io.emit("FAILED-SCAN", {
        code: "PAST_ATTENDANCE_DEADLINE",
        message: SCAN_ERROR_MESSAGES.PAST_ATTENDANCE_DEADLINE,
        member: (member.uid as any).name,
      });
      ScheduledClass.addMemberScan(scid, uid, false);
      throw new ForbiddenError(
        "PAST_ATTENDANCE_DEADLINE",
        SCAN_ERROR_MESSAGES.PAST_ATTENDANCE_DEADLINE,
      );
    }
    const isBooked = await scheduledClass.checkBookedMember(
      uid,
      (member.uid as any).name,
      io,
    );
    if (!isBooked) {
      ScheduledClass.addMemberScan(scid, uid, false);
      throw new NotFoundError(
        "CLASS_NOT_BOOKED",
        SCAN_ERROR_MESSAGES.CLASS_NOT_BOOKED,
      );
    }
    await runInTransaction(async (session: ClientSession) => {
      await Member.recordAttendance(
        uid,
        scid,
        session,
        (member.uid as any).name,
        io,
      );
      await ScheduledClass.addMemberScan(scid, uid, true, session);
    });
    io.emit("SUCCESS-SCAN", {
      code: "CLASS_ATTENDED",
      message: "Success",
      member: (member.uid as any).name,
    });
  }

  static async manualRecordClassAttendance(
    uid: string,
    scid: string,
    io: Server,
  ) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND,
      );
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError(
        "CLASS_NOT_FOUND",
        SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND,
      );
    const isBooked = scheduledClass.bookedMembers.some(
      (b) => b.uid.toString() === uid,
    );
    if (!isBooked) {
      await BookingsService.addBooking(uid, scid, true);
    }

    await runInTransaction(async (session: ClientSession) => {
      await Member.recordAttendance(
        uid,
        scid,
        session,
        (member.uid as any).name,
        io,
      );
      await ScheduledClass.addMemberScan(
        scid,
        uid,
        true,
        session,
        "MANUAL",
      );
    });
    io.emit("SUCCESS-SCAN", {
      code: "CLASS_ATTENDED",
      message: "Success",
      member: (member.uid as any).name,
    });
  }

  static async manualRemoveClassAttendance(uid: string, scid: string) {
    await runInTransaction(async (session: ClientSession) => {
      await Member.removeClassAttendance(uid, scid, session);
      await ScheduledClass.removeSuccessfulMemberScan(scid, uid, session);
    });
  }

  static async recordPtAttendance(uid: string, io: Server) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const pkgs = await Package.find({
      category: "PERSONAL_TRAINING",
    });
    const pkgIds = pkgs.map((p) => p._id.toString());
    if (!pkgIds) {
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Pt Package not found");
    }
    const pkgName = pkgs[0]?.name ?? "Personal Training";
    await runInTransaction(async (session: ClientSession) => {
      const pid = await Member.recordPtAttendance(uid, pkgIds, session, io, pkgName);
      // check if failed record failed
      if (!pid) {
        await DailyAttendance.recordPtAttendance(
          uid,
          "No Active Package",
          session,
          "FAILED",
          io,
        );
        throw new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          SCAN_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE,
        );
      }
      const pkg = await Package.findById(pid);
      if (!pkg)
        throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
      await DailyAttendance.recordPtAttendance(
        uid,
        pkg.name,
        session,
        "SUCCESS",
        io,
      );
      io.emit("SUCCESS-SCAN", {
        code: "PT_CLASS_ATTENDED",
        message: "Success",
        member: (member.uid as any).name,
        coach: pkg.name,
      });
    });
  }

  static async recordLegacyOpenGymAttendance(uid: string, io: Server) {
    const locationId = await resolveLegacyOpenGymLocationId();
    if (!locationId) {
      const member = await Member.findOne({ uid }).populate({ path: "uid" });
      const memberName = member ? (member.uid as any).name : "";
      io.emit("FAILED-SCAN", {
        code: "LEGACY_OPEN_GYM_UNAVAILABLE",
        message: SCAN_ERROR_MESSAGES.LEGACY_OPEN_GYM_UNAVAILABLE,
        member: memberName,
      });
      throw new BadRequestError(
        "LEGACY_OPEN_GYM_UNAVAILABLE",
        SCAN_ERROR_MESSAGES.LEGACY_OPEN_GYM_UNAVAILABLE,
      );
    }
    await BookingsService.recordOpenGymAttendance(uid, io, locationId, {
      legacyPayload: LEGACY_OPEN_GYM_PAYLOAD,
    });
  }

  private static async assertOpenGymBranchExists(
    locationId: string,
    memberName: string,
    io: Server,
  ): Promise<void> {
    if (!isValidOpenGymLocationId(locationId)) {
      io.emit("FAILED-SCAN", {
        code: "INVALID_LOCATION",
        message: SCAN_ERROR_MESSAGES.MALFORMED_LOCATION_ID,
        member: memberName,
      });
      throw new BadRequestError(
        "INVALID_LOCATION",
        SCAN_ERROR_MESSAGES.MALFORMED_LOCATION_ID,
        { locationId },
      );
    }

    const location = await Location.findById(locationId).select("_id");
    if (!location) {
      io.emit("FAILED-SCAN", {
        code: "INVALID_LOCATION",
        message: SCAN_ERROR_MESSAGES.INVALID_LOCATION,
        member: memberName,
      });
      throw new BadRequestError(
        "INVALID_LOCATION",
        SCAN_ERROR_MESSAGES.INVALID_LOCATION,
        { locationId },
      );
    }
  }

  private static async findOpenGymDropInBooking(
    uid: string,
    locationId: string,
  ): Promise<boolean> {
    const member = await Member.findOne({ uid }).populate({
      path: "bookings.scid",
      populate: [{ path: "cid" }, { path: "locationId" }],
    });
    if (!member) {
      return false;
    }

    if (!member?.bookings?.length) {
      return false;
    }

    return member.bookings.some((booking) => {
      if (!booking.isDropIn) {
        return false;
      }
      const scheduledClass = booking.scid as any;
      if (!scheduledClass || typeof scheduledClass !== "object") {
        return false;
      }
      const classDoc = scheduledClass.cid;
      if (!classDoc || classDoc.category !== "WORKSPACE") {
        return false;
      }
      const bookingLocationId =
        scheduledClass.locationId?._id?.toString() ??
        scheduledClass.locationId?.toString();
      return bookingLocationId === locationId;
    });
  }

  static async recordOpenGymAttendance(
    uid: string,
    io: Server,
    locationId?: string,
    options?: { legacyPayload?: string },
  ) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND,
      );

    const memberName = (member.uid as any).name;

    if (locationId) {
      await BookingsService.assertOpenGymBranchExists(
        locationId,
        memberName,
        io,
      );
    }

    const pkgIds = await Package.getSpaceWalkPackageIds();
    if (!pkgIds.length)
      throw new NotFoundError(
        "PACKAGE_NOT_FOUND",
        SCAN_ERROR_MESSAGES.PACKAGE_NOT_FOUND,
      );

    if (
      await DailyAttendance.hasSuccessfulOpenGymToday(
        uid,
        locationId,
      )
    ) {
      io.emit("FAILED-SCAN", {
        code: "ATTENDANCE_ALREADY_RECORDED",
        message: locationId
          ? SCAN_ERROR_MESSAGES.ATTENDANCE_ALREADY_RECORDED
          : SCAN_ERROR_MESSAGES.ATTENDANCE_ALREADY_RECORDED_GENERIC,
        member: memberName,
      });
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        locationId
          ? SCAN_ERROR_MESSAGES.ATTENDANCE_ALREADY_RECORDED
          : SCAN_ERROR_MESSAGES.ATTENDANCE_ALREADY_RECORDED_GENERIC,
      );
    }

    const hasDropIn = locationId
      ? await BookingsService.findOpenGymDropInBooking(uid, locationId)
      : false;

    await runInTransaction(async (session: ClientSession) => {
      if (hasDropIn) {
        await DailyAttendance.recordOpenGymAttendance(
          uid,
          "Drop In",
          session,
          "SUCCESS",
          io,
          locationId,
        );
        io.emit("SUCCESS-SCAN", {
          code: "OPEN_GYM_CLASS_ATTENDED",
          message: "Success",
          member: memberName,
        });
        return;
      }

      const pid = await Member.recordSpaceWalkAttendance(
        uid,
        pkgIds,
        session,
        io,
        locationId,
      );

      if (pid === "NO_ACCESS_AT_LOCATION") {
        await DailyAttendance.recordOpenGymAttendance(
          uid,
          "No Access At Location",
          session,
          "FAILED",
          io,
          locationId,
        );
        throw new ForbiddenError(
          "NO_ACCESS_AT_LOCATION",
          SCAN_ERROR_MESSAGES.NO_ACCESS_AT_LOCATION,
          { locationId },
        );
      }

      if (!pid) {
        await DailyAttendance.recordOpenGymAttendance(
          uid,
          "No Active Package",
          session,
          "FAILED",
          io,
          locationId,
        );
        throw new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          SCAN_ERROR_MESSAGES.NO_ACTIVE_PACKAGE,
        );
      }

      const pkg = await Package.findById(pid);
      if (!pkg)
        throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
      await DailyAttendance.recordOpenGymAttendance(
        uid,
        pkg.name,
        session,
        "SUCCESS",
        io,
        locationId,
      );
      io.emit("SUCCESS-SCAN", {
        code: "OPEN_GYM_CLASS_ATTENDED",
        message: "Success",
        member: memberName,
        ...(options?.legacyPayload
          ? { legacyOpenGymPayload: options.legacyPayload }
          : {}),
        ...(locationId ? { locationId } : {}),
      });
    });
  }

  static async bookAdminDropIn(
    uid: string,
    scid: string,
    paymentMethod: string,
    locationId?: string,
  ) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass: any = await ScheduledClass.findById(scid).populate({
      path: "cid",
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
    if ((scheduledClass.cid as any).allowDropIn === false)
      throw new ConflictError("DROP_IN_DISABLED", "Drop-ins are not allowed for this class");

    const isWorkSpace = (scheduledClass.cid as any).category === "WORKSPACE";
    if (
      !isWorkSpace &&
      new Date() > new Date(scheduledClass.startTime.getTime() + 30 * 60 * 1000)
    )
      throw new ConflictError("CLASS_ALREADY_STARTED", "Class already started");
    let price = scheduledClass.cid.price;
    const scId = new Types.ObjectId(scid);
    await runInTransaction(async (session: ClientSession) => {
      const payment = await PaymentsService.savePayment(
        uid,
        price,
        paymentMethod,
        "DROPIN",
        session,
        undefined,
        undefined,
        scId,
        undefined,
        undefined,
        undefined,
        undefined,
        locationId ?? (scheduledClass as any).locationId?.toString()
      );
      const paymentIdStr = (payment._id as Types.ObjectId).toString();
      
      await Member.saveDropIn(
        uid,
        scid,
        paymentIdStr,
        session,
      );
      await ScheduledClass.bookMember(scid, uid, "Drop In", session);
    });
  }

  static async resolveOpenGymDropInPrice(locationId: string): Promise<number> {
    const workspaceClass = await Class.findOne({
      category: "WORKSPACE",
      locations: new Types.ObjectId(locationId),
    });
    if (!workspaceClass) {
      throw new NotFoundError(
        "OPEN_GYM_PRICE_NOT_CONFIGURED",
        "No open gym drop-in price configured for this branch",
      );
    }
    return workspaceClass.price;
  }

  static async setOpenGymDropInPrice(
    locationId: string,
    price: number,
  ): Promise<{ locationId: string; branchName: string; price: number }> {
    if (price < 0) {
      throw new BadRequestError("INVALID_PRICE", "Price must be zero or greater");
    }
    const location = await Location.findById(locationId);
    if (!location) {
      throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found", {
        locationId,
      });
    }

    let workspaceClass = await Class.findOne({
      category: "WORKSPACE",
      locations: new Types.ObjectId(locationId),
    });

    if (workspaceClass) {
      workspaceClass.price = price;
      await workspaceClass.save();
    } else {
      workspaceClass = await Class.create({
        title: `Open Gym Drop-In — ${location.branchName}`,
        category: "WORKSPACE",
        price,
        locations: [new Types.ObjectId(locationId)],
        allowDropIn: true,
      });
    }

    return {
      locationId,
      branchName: location.branchName,
      price: workspaceClass.price,
    };
  }

  static async listOpenGymDropInPrices(): Promise<
    Array<{
      locationId: string;
      branchName: string;
      location: string;
      price: number | null;
    }>
  > {
    const [locations, workspaceClasses] = await Promise.all([
      Location.find({}),
      Class.find({ category: "WORKSPACE" }),
    ]);

    return locations.map((loc) => {
      const locId = (loc._id as Types.ObjectId).toString();
      const workspaceClass = workspaceClasses.find((cls) =>
        cls.locations.some((branchId) => branchId.toString() === locId),
      );
      return {
        locationId: locId,
        branchName: loc.branchName,
        location: loc.location,
        price: workspaceClass?.price ?? null,
      };
    });
  }

  static async recordAdminOpenGymMemberDropIn(
    uid: string,
    paymentMethod: string,
    io: Server,
    locationId: string,
    amount?: number,
    paymentDate?: string,
  ) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");

    if (await DailyAttendance.hasSuccessfulOpenGymToday(uid, locationId)) {
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Open gym attendance already recorded today at this branch",
      );
    }

    const price = amount ?? (await this.resolveOpenGymDropInPrice(locationId));
    const parsedPaymentDate = paymentDate
      ? new Date(paymentDate).toISOString()
      : undefined;

    await runInTransaction(async (session: ClientSession) => {
      await PaymentsService.savePayment(
        uid,
        price,
        paymentMethod,
        "DROPIN",
        session,
        undefined,
        undefined,
        undefined,
        undefined,
        parsedPaymentDate,
        "Open gym drop-in",
        undefined,
        undefined,
        locationId,
      );
      await DailyAttendance.recordOpenGymAttendance(
        uid,
        "Drop In",
        session,
        "SUCCESS",
        io,
        locationId,
      );
      io.emit("SUCCESS-SCAN", {
        code: "OPEN_GYM_DROP_IN",
        message: "Success",
        member: (member.uid as any).name,
      });
    });
  }

  static async recordAdminOpenGymGuestDropIn(
    name: string,
    phoneNumber: string,
    paymentMethod: string,
    io: Server,
    locationId: string,
    amount?: number,
    paymentDate?: string,
  ) {
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      throw new ConflictError(
        "MEMBER_ALREADY_EXISTS",
        (existingUser._id as Types.ObjectId).toString(),
      );
    }

    if (await DailyAttendance.hasSuccessfulOpenGymGuestToday(phoneNumber, locationId)) {
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Open gym attendance already recorded today for this guest at this branch",
      );
    }

    const price = amount ?? (await this.resolveOpenGymDropInPrice(locationId));
    const parsedPaymentDate = paymentDate
      ? new Date(paymentDate).toISOString()
      : undefined;

    await runInTransaction(async (session: ClientSession) => {
      await PaymentsService.savePayment(
        undefined,
        price,
        paymentMethod,
        "DROPIN",
        session,
        undefined,
        undefined,
        undefined,
        undefined,
        parsedPaymentDate,
        "Open gym guest drop-in",
        name,
        phoneNumber,
        locationId,
      );
      await DailyAttendance.recordOpenGymGuestAttendance(
        name,
        phoneNumber,
        "Drop In",
        session,
        "SUCCESS",
        io,
        locationId,
      );
      io.emit("SUCCESS-SCAN", {
        code: "OPEN_GYM_DROP_IN",
        message: "Success",
        member: name,
      });
    });
  }

  static async bookDropIn(
    uid: string,
    scid: string,
    merchantReferenceId: string,
    promoCode?: string,
  ) {
    const scheduledClass: any = await ScheduledClass.findById(scid).populate({
      path: "cid",
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");

    const pendingMember = await isPendingMember(uid);
    if (pendingMember) {
      await assertMatchaSessionForPendingUser(scheduledClass);
    }

    let member = await Member.findOne({ uid });
    if (!member) {
      await ensureMemberForPendingPurchase(uid);
      member = await Member.findOne({ uid });
    }
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    if ((scheduledClass.cid as any).category === "WORKSPACE")
      throw new ConflictError(
        "DROP_IN_ADMIN_ONLY",
        "Open gym drop-ins can only be booked by staff",
      );
    if ((scheduledClass.cid as any).allowDropIn === false)
      throw new ConflictError("DROP_IN_DISABLED", "Drop-ins are not allowed for this class");

    if (
      new Date() > new Date(scheduledClass.startTime.getTime() + 30 * 60 * 1000)
    )
      throw new ConflictError("CLASS_ALREADY_STARTED", "Class already started");
    let price = scheduledClass.cid.price;
    if (promoCode) {
      const discountedPrice = await PromoCode.getDiscountedPrice(
        promoCode,
        scheduledClass.cid.price,
        "CLASS",
      );
      if (discountedPrice === null)
        throw new NotFoundError("PROMO_CODE_NOT_FOUND", "Promo code not found");
      price = discountedPrice;
    }

    // Enforce Waitlist Reservations
    let userHasReservation = null;
    {
      const activeReservationsCount = await Reservation.countDocuments({
        sessionId: scheduledClass._id,
        status: "ACTIVE"
      });
      userHasReservation = await Reservation.findOne({
        sessionId: scheduledClass._id,
        userId: new Types.ObjectId(uid),
        status: "ACTIVE"
      });
      
      const publicSlots = scheduledClass.availableSlots - activeReservationsCount;
      if (publicSlots <= 0 && !userHasReservation) {
        const expiredReservation = await Reservation.findOne({
          sessionId: scheduledClass._id,
          userId: new Types.ObjectId(uid),
          status: "EXPIRED"
        });
        if (expiredReservation) {
          throw new ForbiddenError("RESERVATION_EXPIRED", "Your reservation window has expired. The spot has been passed to the next person.");
        }

        const waitingEntry = await WaitlistEntry.findOne({
          sessionId: scheduledClass._id,
          userId: new Types.ObjectId(uid),
          status: "WAITING"
        });
        if (waitingEntry) {
          throw new ForbiddenError("STILL_WAITING", "You are currently on the waitlist. We will notify you when it is your turn.");
        }

        throw new ForbiddenError("SPOT_RESERVED", "Available spots are currently reserved for waitlisted members. Please join the waitlist.");
      }
    }

    const orderId = await PaymentsService.checkPayment(
      merchantReferenceId,
      price,
    );
    const scId = new Types.ObjectId(scid);
    await runInTransaction(async (session: ClientSession) => {
      const payment = await PaymentsService.savePayment(
        uid,
        price,
        "APP",
        "DROPIN",
        session,
        orderId,
        merchantReferenceId,
        scId,
        undefined,
        undefined,
        undefined,
        undefined,
        (scheduledClass as any).locationId?.toString()
      );
      await Member.saveDropIn(
        uid,
        scid,
        (payment._id as Types.ObjectId).toString(),
        session,
      );
      await ScheduledClass.bookMember(scid, uid, "Drop In", session);
      await sendPaymentToRentalSystem(payment);

      // If user had a reservation, mark it COMPLETED
      if (userHasReservation) {
        userHasReservation.status = "COMPLETED";
        await userHasReservation.save({ session });
        await WaitlistEntry.updateOne(
          { sessionId: scheduledClass._id, userId: new Types.ObjectId(uid), status: "NOTIFIED" },
          { status: "BOOKED" },
          { session }
        );
      }
    });
  }

  // Non user services
  static async getNonUserBookings(
    startTime?: Date,
    endTime?: Date,
    scid?: string,
    locationId?: string,
  ): Promise<INonUserBooking[]> {
    const query: any = {};
    if (startTime) query.startTime = { $gte: startTime };
    if (endTime) query.endTime = { $lte: endTime };
    if (scid) query.scid = scid;
    
    if (locationId) {
      const locationObjectId = Types.ObjectId.isValid(locationId)
        ? new Types.ObjectId(locationId)
        : locationId;
      const scheduledClasses = await ScheduledClass.find({
        locationId: locationObjectId,
      }).select("_id");
      const validScids = scheduledClasses.map(sc => (sc as any)._id.toString());
      if (scid) {
        if (!validScids.includes(scid)) return [];
      } else {
        query.scid = { $in: validScids };
      }
    }
    
    return NonUserBooking.find(query);
  }

  static async addNonUserBooking(
    name: string,
    phoneNumber: string,
    scid: string,
    session?: ClientSession,
  ): Promise<INonUserBooking> {
    let booking;
    const scheduledClass = await ScheduledClass.findById(scid).populate<{ cid: { allowDropIn: boolean } }>("cid");
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
    if (scheduledClass.cid.allowDropIn === false)
      throw new ConflictError("DROP_IN_DISABLED", "Drop-ins are not allowed for this class");
    const run = async (s: ClientSession) => {
      scheduledClass.availableSlots = scheduledClass.availableSlots + 1;
      await scheduledClass.save({ session });
      booking = await NonUserBooking.addBooking(scid, name, phoneNumber, s);
      logger.info("Booking saved in booking service function: ", booking);
      await ScheduledClass.bookNonUser(scid, s);
      if (!booking)
        throw new NotFoundError("BOOKING_NOT_FOUND", "Booking not found");
      return booking;
    };
    if (session) {
      const result = await run(session);
      logger.info("Booking result: ", result);
      return result;
    }
    const result = await runInTransaction(run);
    logger.info("Booking result: ", result);
    return result;
  }

  static async adminPromoteFromWaitlist(uid: string, scid: string) {
    await ScheduledClass.assertOnWaitlist(scid, uid);
    await BookingsService.addBooking(uid, scid, true);
    await ScheduledClass.removeMemberFromWaitlist(scid, uid);
  }

  static async adminAddToWaitlist(uid: string, scid: string) {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled class not found");
    await ScheduledClass.addMemberToWaitlistOverride(scid, uid);
  }

  static async adminRemoveFromWaitlist(uid: string, scid: string) {
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled class not found");
    await ScheduledClass.removeMemberFromWaitlist(scid, uid);
  }

  static async getWaitlistedMembers(scid: string) {
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "waitlistedMembers.uid",
      model: "User",
      select: "name phone",
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled class not found");
    return scheduledClass.waitlistedMembers;
  }

  static async addMemberToWaitingList(
    uid: string,
    fcmToken: string,
    scid: string,
  ) {
    // Also save the FCM token to the user if not exists
    const user = await User.findById(uid);
    if (user && !user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
      await user.save();
    }
    await WaitlistService.joinWaitlist(uid, scid);
  }

  static async recordNonUserAttendance(
    bookingId: string,
    session?: ClientSession,
  ): Promise<INonUserBooking> {
    const run = async (s: ClientSession) => {
      if (session) logger.info(`In session - ${session?.id?.toString()}`);
      const booking = await NonUserBooking.findById(bookingId).session(s);
      logger.info("Using bookingId: ", bookingId);
      if (!booking)
        throw new NotFoundError("BOOKING_NOT_FOUND", "Booking is not found");
      if (booking.status != "BOOKED") {
        throw new ConflictError(
          "ATTENDANCE_RECORDED",
          "Attendance was already recorded for this booking",
        );
      }
      const scheduledClass = await ScheduledClass.findById(booking.scid)
        .populate({ path: "cid" })
        .session(s);
      if (!scheduledClass)
        throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");

      const attendedBooking = await NonUserBooking.recordAttendance(
        bookingId,
        s,
      );
      return attendedBooking;
    };

    if (session) {
      const result = await run(session);

      logger.info(
        `Using session - ${session?.id?.toString()} - for attendance`,
      );
      return result;
    }
    logger.info("Created independent session for attendance");
    const result = await runInTransaction(run);
    return result;
  }

  static async recordNonUserPayment(
    bookingId: string,
    paymentMethod: string,
    amount?: number,
    paymentDate?: string,
    session?: ClientSession,
    locationId?: string,
  ): Promise<INonUserBooking> {
    const run = async (s: ClientSession) => {
      if (session) logger.info(`In session - ${session?.id?.toString()}`);
      const booking = await NonUserBooking.findById(bookingId).session(s);
      logger.info("Using bookingId: ", bookingId);
      if (!booking)
        throw new NotFoundError("BOOKING_NOT_FOUND", "Booking is not found");
      if (booking.status !== "ATTENDED")
        throw new BadRequestError(
          "USER_NOT_ATTENDED",
          "The user hasn't attended yet",
        );
      const scheduledClass = await ScheduledClass.findById(booking.scid)
        .populate({ path: "cid" })
        .session(s);
      if (!scheduledClass)
        throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
      const paymentAmount = amount !== undefined ? amount : (scheduledClass.cid as any).price;
      const payment = await PaymentsService.savePayment(
        undefined,
        paymentAmount,
        paymentMethod,
        "NON_USER_BOOKING",
        s,
        undefined,
        undefined,
        scheduledClass._id as Types.ObjectId,
        undefined,
        paymentDate,
        undefined,
        booking.name,
        booking.phoneNumber,
        locationId ?? (scheduledClass as any).locationId?.toString()
      );
      const paidBooking = await NonUserBooking.recordPayment(
        bookingId,
        (payment._id as Types.ObjectId).toString(),
        s,
      );
      sendPaymentToRentalSystem(payment);
      return paidBooking;
    };
    if (session) {
      const result = await run(session);
      logger.info(`Using session - ${session?.id?.toString()} - for payment`);
      return result;
    }
    logger.info("Created independent session for payment");
    const result = await runInTransaction(run);
    return result;
  }

  static async cancelNonUserBooking(
    bookingId: string,
  ): Promise<INonUserBooking> {
    const booking = await NonUserBooking.findById(bookingId);
    if (!booking)
      throw new NotFoundError("BOOKING_NOT_FOUND", "Booking is not found");
    await runInTransaction(async (session: ClientSession) => {
      const attendedBooking = await NonUserBooking.cancelBooking(
        bookingId,
        session,
      );
      await ScheduledClass.removeBookedNonUser(
        booking.scid.toString(),
        session,
      );
      return attendedBooking;
    });
    return booking;
  }
}
