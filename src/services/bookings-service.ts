import { ClientSession, Types } from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
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
import logger from "../config/logger";
import NonUserBooking, { INonUserBooking } from "../models/nonUserBookings";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
import { NotificationsService } from "./notifications-service";
import ChallengeRecord from "../models/challengeRecord";

export class BookingsService {
  static async addBooking(uid: string, scid: string, isAdminOverride: boolean = false) {
    // Validate Member and ScheduledClass
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "cid",
      populate: { path: "locations" },
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");

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
    const location = (scheduledClass as any).cid.locations[0].branchName;
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
      );
      const waitingList = await ScheduledClass.removeBookedMember(
        scid,
        uid,
        session,
      );

      // notify waiting list
      // if (waitingList)
      //   await NotificationsService.notifyWaitingList(
      //     waitingList,
      //     (scheduledClass.cid as any).title,
      //     scheduledClass.startTime.getDay(),
      //   );
    });
  }

  static async cancelDropIn(uid: string, scid: string): Promise<void> {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
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
      //notify wainting list
      // if (waitingList)
      //   await NotificationsService.notifyWaitingList(
      //     waitingList,
      //     classTitle ?? "Class",
      //     scheduledClass.startTime.getDay(),
      //   );
    });
  }

  static async recordAttendance(uid: string, scid: string, io: Server) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
    const attendanceDeadline = new Date(
      scheduledClass.startTime.getTime() + 30 * 60 * 1000,
    );
    if (new Date() > attendanceDeadline) {
      io.emit("FAILED-SCAN", {
        code: "PAST_ATTENDANCE_DEADLINE",
        message: "Attendance deadline passed",
        member: (member.uid as any).name,
      });
      ScheduledClass.addMemberScan(scid, uid, false);
      throw new ForbiddenError(
        "PAST_ATTENDANCE_DEADLINE",
        "Class has started 30mins ago",
      );
    }
    const isBooked = await scheduledClass.checkBookedMember(
      uid,
      (member.uid as any).name,
      io,
    );
    if (!isBooked) {
      ScheduledClass.addMemberScan(scid, uid, false);
      throw new NotFoundError("CLASS_NOT_BOOKED", "Member not booked");
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
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found");
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
          "No active packages found",
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

  static async recordOpenGymAttendance(uid: string, io: Server) {
    const member = await Member.findOne({ uid }).populate({ path: "uid" });
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const pkg = await Package.findOne({ category: "OPEN_GYM" });
    if (!pkg)
      throw new NotFoundError(
        "PACKAGE_NOT_FOUND",
        "Open gym Package not found",
      );
    if (pkg.category !== "OPEN_GYM")
      throw new BadRequestError(
        "INVALID_PACKAGE",
        "Package is not an Open Gym package",
      );
    const ultimatePkgs = await Package.find({
      category: "ULTIMATE_MINDSPACER",
    });
    let pkgIds = ultimatePkgs.map((pkg) => pkg._id.toString());
    pkgIds.push(pkg._id.toString());
    await runInTransaction(async (session: ClientSession) => {
      const memberDoc = await Member.findOne({ uid })
        .populate({ path: "uid" })
        .session(session);
      if (!memberDoc)
        throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
      await memberDoc.recordOpenGymAttendance(pkgIds, session, io);
    });

    io.emit("SUCCESS-SCAN", {
      code: "OPEN_GYM_CLASS_ATTENDED",
      message: "Success",
      member: (member.uid as any).name,
    });
  }

  static async bookAdminDropIn(
    uid: string,
    scid: string,
    paymentMethod: string,
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

  static async bookDropIn(
    uid: string,
    scid: string,
    merchantReferenceId: string,
    promoCode?: string,
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
      );
      await Member.saveDropIn(
        uid,
        scid,
        (payment._id as Types.ObjectId).toString(),
        session,
      );
      await ScheduledClass.bookMember(scid, uid, "Drop In", session);
      await sendPaymentToRentalSystem(payment);
    });
  }

  // Non user services
  static async getNonUserBookings(
    startTime?: Date,
    endTime?: Date,
    scid?: string,
  ): Promise<INonUserBooking[]> {
    const query: {
      startTime?: Record<string, Date>;
      endTime?: Record<string, Date>;
      scid?: string;
    } = {};
    if (startTime) query.startTime = { $gte: startTime };
    if (endTime) query.endTime = { $lte: endTime };
    if (scid) query.scid = scid;
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

  static async addMemberToWaitingList(
    uid: string,
    fcmToken: string,
    scid: string,
  ) {
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass)
      return new NotFoundError(
        "CLASS_NOT_FOUND",
        "Scheduled Class is not found!",
      );
    const user = await User.findById(uid);
    if (!user) return new NotFoundError("USER_NOT_FOUND", "User is not found!");
    if (!user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
      await user.save();
    }
    await scheduledClass.addMemberToWaitingList(fcmToken);
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
