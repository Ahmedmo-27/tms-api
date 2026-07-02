import { ClientSession, Types } from "mongoose";
import ScheduledClass from "../models/scheduledClass";
import WaitlistEntry from "../models/waitlistEntry";
import Reservation from "../models/reservation";
import User from "../models/user";
import { NotificationsService } from "./notifications-service";
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
} from "../core/ApiError";
import logger from "../config/logger";
import { runInTransaction } from "../utils/transaction";
import {
  assertMatchaSessionForPendingUser,
  isPendingMember,
} from "../utils/matcha-branch";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export class WaitlistService {
  static async joinWaitlist(uid: string, scid: string) {
    const scheduledClass = await ScheduledClass.findById(scid);
    if (!scheduledClass) {
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled Class not found");
    }

    if (await isPendingMember(uid)) {
      await assertMatchaSessionForPendingUser(scheduledClass);
    }

    if (scheduledClass.availableSlots > 0) {
      throw new BadRequestError("SLOTS_AVAILABLE", "Cannot join waitlist when slots are available");
    }

    const user = await User.findById(uid);
    if (!user) throw new NotFoundError("USER_NOT_FOUND", "User not found");

    const existingEntry = await WaitlistEntry.findOne({
      sessionId: new Types.ObjectId(scid),
      userId: new Types.ObjectId(uid),
      status: { $in: ["WAITING", "NOTIFIED"] },
    });

    if (existingEntry) {
      throw new ConflictError("ALREADY_IN_WAITLIST", "User is already in the waitlist");
    }

    const count = await WaitlistEntry.countDocuments({
      sessionId: new Types.ObjectId(scid),
      status: "WAITING",
    });

    const entry = new WaitlistEntry({
      sessionId: new Types.ObjectId(scid),
      userId: new Types.ObjectId(uid),
      position: count + 1,
      status: "WAITING",
    });

    await entry.save();
    return entry;
  }

  static async leaveWaitlist(uid: string, scid: string) {
    const entry = await WaitlistEntry.findOneAndUpdate(
      {
        sessionId: new Types.ObjectId(scid),
        userId: new Types.ObjectId(uid),
        status: { $in: ["WAITING", "NOTIFIED"] },
      },
      {
        status: "CANCELLED",
      },
      { new: true }
    );

    if (!entry) {
      throw new NotFoundError("WAITLIST_ENTRY_NOT_FOUND", "Waitlist entry not found");
    }

    // If they were NOTIFIED, they held a reservation. Expire it.
    if (entry.status === "NOTIFIED") {
      await Reservation.updateMany(
        {
          sessionId: new Types.ObjectId(scid),
          userId: new Types.ObjectId(uid),
          status: "ACTIVE",
        },
        { status: "CANCELLED" }
      );
      // Trigger processing for the next person
      await WaitlistService.processWaitlist(scid);
    }
  }

  static async processWaitlist(scid: string) {
    const scheduledClass = await ScheduledClass.findById(scid).populate({
      path: "cid",
    });
    if (!scheduledClass) return;

    if (scheduledClass.availableSlots <= 0) return;

    const now = new Date();
    const remainingTime = scheduledClass.startTime.getTime() - now.getTime();

    // 1-Hour Cutoff Rule
    if (remainingTime <= HOUR) {
      logger.info(`Waitlist cutoff reached for class ${scid}. Spot is public.`);
      return;
    }

    // Ensure only one ACTIVE reservation per session spot
    const activeReservation = await Reservation.findOne({
      sessionId: new Types.ObjectId(scid),
      status: "ACTIVE",
    });
    if (activeReservation) {
      logger.info(`Active reservation already exists for class ${scid}. Waitlist paused.`);
      return;
    }

    const waitingUsers = await WaitlistEntry.find({
      sessionId: new Types.ObjectId(scid),
      status: "WAITING",
    }).sort({ position: 1 });

    if (waitingUsers.length === 0) return;

    const usableTime = remainingTime - HOUR;
    const minimumWindow = 5 * MINUTE;
    const maxProcessableUsers = Math.floor(usableTime / minimumWindow);

    if (maxProcessableUsers <= 0) return;

    const eligibleUsers = waitingUsers.slice(0, maxProcessableUsers);
    if (eligibleUsers.length === 0) return;

    const selectedEntry = eligibleUsers[0];
    const eligibleCount = eligibleUsers.length;

    // Calculate Dynamic Reservation Window
    let dynamicWindow = 0;
    const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

    if (remainingTime <= 6 * HOUR) {
      dynamicWindow = clamp(remainingTime * 0.15, 10 * MINUTE, 45 * MINUTE);
    } else {
      dynamicWindow = clamp(remainingTime * 0.25, 30 * MINUTE, 120 * MINUTE);
    }

    const fairShareWindow = usableTime / eligibleCount;
    let reservationWindow = Math.min(dynamicWindow, fairShareWindow);
    reservationWindow = clamp(reservationWindow, 5 * MINUTE, dynamicWindow);

    const expiresAt = new Date(now.getTime() + reservationWindow);

    await runInTransaction(async (session: ClientSession) => {
      // Create Reservation
      const reservation = new Reservation({
        sessionId: new Types.ObjectId(scid),
        userId: selectedEntry.userId,
        status: "ACTIVE",
        createdAt: now,
        expiresAt,
      });
      await reservation.save({ session });

      // Update Waitlist Entry
      selectedEntry.status = "NOTIFIED";
      selectedEntry.notifiedAt = now;
      selectedEntry.reservationExpiresAt = expiresAt;
      await selectedEntry.save({ session });
    });

    // Notify User (best-effort — notification failure must not roll back the reservation)
    try {
      const user = await User.findById(selectedEntry.userId);
      if (user && user.fcmTokens && user.fcmTokens.length > 0) {
        const classTitle = (scheduledClass.cid as any).title || "Class";
        await NotificationsService.notifyWaitlistUser(
          (user._id as Types.ObjectId).toString(),
          user.fcmTokens,
          classTitle,
          scheduledClass.startTime.getDay(),
          expiresAt
        );
      }
    } catch (notifyErr) {
      logger.warn("Waitlist notification failed (non-fatal):", notifyErr);
    }
  }

  static async expireReservations() {
    try {
      const now = new Date();
      const expiredReservations = await Reservation.find({
        status: "ACTIVE",
        expiresAt: { $lte: now },
      });

      for (const res of expiredReservations) {
        await runInTransaction(async (session: ClientSession) => {
          res.status = "EXPIRED";
          await res.save({ session });

          await WaitlistEntry.updateOne(
            {
              sessionId: res.sessionId,
              userId: res.userId,
              status: "NOTIFIED",
            },
            { status: "EXPIRED" },
            { session }
          );
        });

        logger.info(`Expired reservation for user ${res.userId} on class ${res.sessionId}`);
        
        // Process next waitlist member
        await WaitlistService.processWaitlist(res.sessionId.toString());
      }
    } catch (error) {
      logger.error("Error running expireReservations cron job:", error);
    }
  }
}
