import { runInTransaction } from "../utils/transaction";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../core/ApiError";
import Class from "../models/class";
import Schedule from "../models/schedule";
import ScheduledClass from "../models/scheduledClass";
import DailyAttendance from "../models/dailyAttendance";
import { IScheduledClass } from "../models/scheduledClass";
import { ClientSession, Types } from "mongoose";
import Member, { IMember } from "../models/member";
import Package from "../models/package";
import logger from "../config/logger";
import Payment from "../models/payment";
import { PaymentsService } from "./payments-service";
import { NotificationsService } from "./notifications-service";
import { WaitlistService } from "./waitlist-service";

export class SchedulerService {
  static async getSchedule(date: string, locationId?: string): Promise<IScheduledClass[]> {
    const scheduledClassesIds = await Schedule.getClasses(date as string);
    if (!scheduledClassesIds || scheduledClassesIds.length === 0)
      throw new NotFoundError(
        "CLASSES_NOT_FOUND",
        "No classes scheduled for this day",
        { date },
      );
    const query: any = { _id: { $in: scheduledClassesIds } };
    if (locationId) query.locationId = locationId;
    
    const scheduledClasses = await ScheduledClass.find(query)
      .populate({ path: "scans.uid" })
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId", select: "branchName location locationUrl" })
      .populate({ path: "coachId" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" })
      .sort({ startTime: 1 });
    return scheduledClasses.map((cls) => cls.toObject());
  }

  static async getNextSchedule(locationId?: string) {
    const scheduledClassesIds = await Schedule.getNextClasses();
    if (!scheduledClassesIds || scheduledClassesIds.length === 0)
      throw new NotFoundError(
        "CLASSES_NOT_FOUND",
        "No classes scheduled for this week",
      );
    const objectIds = scheduledClassesIds.map((id) => new Types.ObjectId(id));
    const query: any = { _id: { $in: objectIds } };
    if (locationId) query.locationId = locationId;

    const scheduledClasses = await ScheduledClass.find(query)
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId", select: "branchName location locationUrl" })
      .populate({ path: "coachId" })
      .populate({ path: "scans.uid" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" });

    return scheduledClasses.map((cls) => cls.toObject());
  }

  static async getAllScheduledClasses(locationId?: string): Promise<IScheduledClass[]> {
    const scheduledClassesIds = await Schedule.getAllClasses();
    const objectIds = scheduledClassesIds.map((id) => new Types.ObjectId(id));
    const query: any = { _id: { $in: objectIds } };
    if (locationId) query.locationId = locationId;
    
    const scheduledClasses = await ScheduledClass.find(query)
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId", select: "branchName location locationUrl" })
      .populate({ path: "coachId" })
      .populate({ path: "scans.uid" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" });

    return scheduledClasses.map((cls) => cls.toObject());
  }

  static async scheduleClass(
    cid: string,
    startTime: string,
    endTime: string,
    availableSlots: string,
    coachId: string | string[],
    locationId: string
  ): Promise<IScheduledClass> {
    const cls = await Class.findById(cid);
    if (!cls)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { cid });
    if (await ScheduledClass.findOne({ cid, startTime, locationId }))
      throw new ConflictError(
        "CLASS_ALREADY_SCHEDULED",
        "Class already scheduled for this time at this location",
        {
          cid,
          startTime,
        },
      );

    const scheduledClass = new ScheduledClass({
      cid,
      className: cls.title,
      startTime,
      endTime,
      availableSlots,
      locationId,
      coachId: Array.isArray(coachId) ? coachId.map(id => new Types.ObjectId(id)) : (coachId ? [new Types.ObjectId(coachId)] : []),
    });
    await scheduledClass.save();
    await Schedule.scheduleClass(scheduledClass._id as string);
    return scheduledClass;
  }

  static async cancelClass(scid: string) {
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "cid",
    });
    if (!scheduledClass)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
    logger.info("Canceling", { scheduledClass });
    const pkgs = await Package.find({ opensClasses: scheduledClass.cid });
    const pkgIds = pkgs.map((p) => p._id.toString());
    logger.info("IDS: ", pkgIds);
    logger.info("ALL BOOKED MEMBERS", scheduledClass.bookedMembers);
    const isDeducted =
      (scheduledClass.cid as any).category !== "WORKSPACE" &&
      (scheduledClass.cid as any).price != 0;
    await runInTransaction(async (session: ClientSession) => {
      for (const bookedMember of scheduledClass.bookedMembers) {
        const member = await Member.findOne({ uid: bookedMember.uid }).session(
          session,
        );
        if (!member)
          throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", {
            uid: bookedMember.uid,
          });
        logger.info("Handling", { member });
        await Member.removeBooking(
          bookedMember.uid.toString(),
          scid,
          pkgIds,
          isDeducted,
          session,
          undefined,
          undefined,
          "FRONTDESK_CANCELLATION",
        );
      }
      await Schedule.cancelClass(scid, session);
      await ScheduledClass.deleteOne({ _id: scid }, { session });
      const classTitle = (scheduledClass as { className?: string }).className;
      const refundReason = classTitle
        ? `Scheduled class cancelled: ${classTitle}`
        : "Scheduled class cancelled";
      const payments = await Payment.find({ scid }).session(session);
      for (const payment of payments) {
        if (!payment)
          throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment was not found");
        await PaymentsService.refundPayment(
          (payment._id as Types.ObjectId).toString(),
          session,
          refundReason,
        );
      }
    });
  }

  static async editClass(
    updatedClass: Record<string, any>,
    scid: string,
  ): Promise<IScheduledClass | null> {
    const validUpdates = ["startTime", "endTime", "availableSlots", "coachId"];
    const updates = Object.keys(updatedClass);
    const isValidUpdate = updates.every((update) =>
      validUpdates.includes(update),
    );
    let newClass = null;
    if (!isValidUpdate)
      throw new BadRequestError("INVALID_UPDATES", "Invalid updates");
    const { startTime, endTime, availableSlots, coachId } = updatedClass;
    await runInTransaction(async (session: ClientSession) => {
      const scheduledClass = await ScheduledClass.findById(scid);
      logger.info("Original Class", { scheduledClass });
      if (!scheduledClass)
        throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
      newClass = await ScheduledClass.findByIdAndUpdate(
        scid,
        {
          startTime,
          endTime,
          availableSlots,
          coachId: coachId 
            ? (Array.isArray(coachId) ? coachId.map(id => new Types.ObjectId(id as string)) : [new Types.ObjectId(coachId as string)]) 
            : undefined,
        },
        { new: true },
      );
      logger.info("New Class", { newClass });
      if (!newClass)
        throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
      if (startTime || endTime) {
        await Schedule.rescheduleClass(scheduledClass, newClass, session);
      }
    });

    // Trigger waitlist processing if slots were increased
    if (availableSlots !== undefined) {
      const scheduledClassOld = await ScheduledClass.findById(scid);
      if (scheduledClassOld && Number(availableSlots) > scheduledClassOld.availableSlots) {
        await WaitlistService.processWaitlist(scid);
      }
    }

    return newClass;
  }

  static async getDayAttendance(date: string) {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const dailyAttendance = await DailyAttendance.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate({ path: "ptAttendance.uid" })
      .populate({ path: "openGymAttendance.uid" });
    return dailyAttendance;
  }
}
