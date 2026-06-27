import { runInTransaction } from "../utils/transaction";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../core/ApiError";
import Class from "../models/class";
import Location from "../models/location";
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

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mobile clients sometimes send coachId as {"0":"..."} instead of an array. */
const normalizeCoachIds = (
  coachId: string | string[] | Record<string, string> | undefined,
): string[] => {
  if (!coachId) return [];
  if (Array.isArray(coachId)) return coachId.map(String);
  if (typeof coachId === "object") return Object.values(coachId).map(String);
  return [String(coachId)];
};

export class SchedulerService {
  private static async resolveLocationId(
    locationRaw: string | undefined,
  ): Promise<Types.ObjectId> {
    if (!locationRaw)
      throw new BadRequestError("LOCATION_REQUIRED", "Location is required");

    let resolvedId: Types.ObjectId;
    if (Types.ObjectId.isValid(locationRaw)) {
      resolvedId = new Types.ObjectId(locationRaw);
    } else {
      const escaped = escapeRegex(locationRaw.trim());
      const foundLoc = await Location.findOne({
        $or: [
          { branchName: { $regex: new RegExp(`^${escaped}$`, "i") } },
          { location: { $regex: new RegExp(`^${escaped}$`, "i") } },
        ],
      });
      if (!foundLoc)
        throw new BadRequestError(
          "INVALID_LOCATION",
          `Location "${locationRaw}" not found`,
        );
      resolvedId = foundLoc._id as Types.ObjectId;
    }

    const locationDoc = await Location.findById(resolvedId);
    if (!locationDoc)
      throw new NotFoundError("LOCATION_NOT_FOUND", "Location not found", {
        locationId: resolvedId,
      });

    return resolvedId;
  }

  /**
   * Legacy mobile app filters/displays using cid.locations (class template) instead of
   * locationId (session branch). Shape the response so those fields only contain
   * this session's branch until the app is updated.
   */
  private static shapeSessionForLegacyClients(cls: any) {
    const doc = typeof cls.toObject === "function" ? cls.toObject() : { ...cls };
    const sessionLocation = cls.locationId;

    if (!sessionLocation) {
      return {
        ...doc,
        locations: doc.cid?.locations ?? [],
      };
    }

    const sessionLocObj =
      typeof sessionLocation.toObject === "function"
        ? sessionLocation.toObject()
        : sessionLocation;
    const sessionLocations = [sessionLocObj];
    const cid = doc.cid
      ? { ...doc.cid, locations: sessionLocations }
      : doc.cid;

    return {
      ...doc,
      cid,
      locations: sessionLocations,
      sessionBranchName: sessionLocObj.branchName,
      sessionLocationCity: sessionLocObj.location,
    };
  }

  static async getSchedule(date: string): Promise<IScheduledClass[]> {
    const scheduledClassesIds = await Schedule.getClasses(date as string);
    if (!scheduledClassesIds || scheduledClassesIds.length === 0)
      throw new NotFoundError(
        "CLASSES_NOT_FOUND",
        "No classes scheduled for this day",
        { date },
      );
    const scheduledClasses = await ScheduledClass.find({
      _id: { $in: scheduledClassesIds },
    })
      .populate({ path: "scans.uid" })
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId" })
      .populate({ path: "coachId" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" })
      .sort({ startTime: 1 });
    return scheduledClasses.map((cls) =>
      this.shapeSessionForLegacyClients(cls),
    );
  }

  static async getNextSchedule() {
    const scheduledClassesIds = await Schedule.getNextClasses();
    if (!scheduledClassesIds || scheduledClassesIds.length === 0)
      throw new NotFoundError(
        "CLASSES_NOT_FOUND",
        "No classes scheduled for this week",
      );
    const objectIds = scheduledClassesIds.map((id) => new Types.ObjectId(id));
    const scheduledClasses = await ScheduledClass.find({
      _id: { $in: objectIds },
    })
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId" })
      .populate({ path: "coachId" })
      .populate({ path: "scans.uid" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" });

    return scheduledClasses;
  }

  static async getAllScheduledClasses(): Promise<IScheduledClass[]> {
    const scheduledClassesIds = await Schedule.getAllClasses();
    const objectIds = scheduledClassesIds.map((id) => new Types.ObjectId(id));
    const scheduledClasses = await ScheduledClass.find({
      _id: { $in: objectIds },
    })
      .populate({ path: "cid", populate: { path: "locations" } })
      .populate({ path: "locationId" })
      .populate({ path: "coachId" })
      .populate({ path: "scans.uid" })
      .populate({ path: "bookedMembers.uid", select: "name phoneNumber" });

    return scheduledClasses;
  }

  static async scheduleClass(
    cid: string,
    startTime: string,
    endTime: string,
    availableSlots: string,
    coachId: string | string[] | Record<string, string>,
    locationRaw?: string,
  ): Promise<IScheduledClass> {
    const cls = await Class.findById(cid);
    if (!cls)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { cid });

    const locationId = await this.resolveLocationId(locationRaw);

    if (
      await ScheduledClass.findOne({ cid, startTime, locationId })
    )
      throw new ConflictError(
        "CLASS_ALREADY_SCHEDULED",
        "Class already scheduled for this time at this location",
        {
          cid,
          startTime,
          locationId,
        },
      );

    const scheduledClass = new ScheduledClass({
      cid,
      locationId,
      className: cls.title,
      startTime,
      endTime,
      availableSlots,
      coachId: normalizeCoachIds(coachId).map((id) => new Types.ObjectId(id)),
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
    const validUpdates = [
      "startTime",
      "endTime",
      "availableSlots",
      "coachId",
      "locationId",
      "location",
    ];
    const updates = Object.keys(updatedClass);
    const isValidUpdate = updates.every((update) =>
      validUpdates.includes(update),
    );
    let newClass = null;
    if (!isValidUpdate)
      throw new BadRequestError("INVALID_UPDATES", "Invalid updates");
    const {
      startTime,
      endTime,
      availableSlots,
      coachId,
      locationId: locationIdRaw,
      location: locationName,
    } = updatedClass;
    await runInTransaction(async (session: ClientSession) => {
      const scheduledClass = await ScheduledClass.findById(scid);
      logger.info("Original Class", { scheduledClass });
      if (!scheduledClass)
        throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });

      let resolvedLocationId: Types.ObjectId | undefined;
      const locationInput = locationIdRaw ?? locationName;
      if (locationInput !== undefined) {
        resolvedLocationId = await this.resolveLocationId(
          String(locationInput),
        );
        if (
          (startTime || scheduledClass.startTime) &&
          (await ScheduledClass.findOne({
            _id: { $ne: scid },
            cid: scheduledClass.cid,
            startTime: startTime ?? scheduledClass.startTime,
            locationId: resolvedLocationId,
          }))
        )
          throw new ConflictError(
            "CLASS_ALREADY_SCHEDULED",
            "Class already scheduled for this time at this location",
            {
              cid: scheduledClass.cid,
              startTime: startTime ?? scheduledClass.startTime,
              locationId: resolvedLocationId,
            },
          );
      } else if (startTime) {
        const effectiveLocationId = scheduledClass.locationId;
        if (
          effectiveLocationId &&
          (await ScheduledClass.findOne({
            _id: { $ne: scid },
            cid: scheduledClass.cid,
            startTime,
            locationId: effectiveLocationId,
          }))
        )
          throw new ConflictError(
            "CLASS_ALREADY_SCHEDULED",
            "Class already scheduled for this time at this location",
            {
              cid: scheduledClass.cid,
              startTime,
              locationId: effectiveLocationId,
            },
          );
      }

      newClass = await ScheduledClass.findByIdAndUpdate(
        scid,
        {
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          ...(availableSlots !== undefined && { availableSlots }),
          ...(resolvedLocationId !== undefined && { locationId: resolvedLocationId }),
          ...(coachId !== undefined && {
            coachId: normalizeCoachIds(coachId).map(
              (id) => new Types.ObjectId(id),
            ),
          }),
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
