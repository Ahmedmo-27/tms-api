import logger from "../config/logger";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import { CAIRO_TZ } from "../utils/timezone";
import { NotificationsService } from "./notifications-service";

/** Only classes that ended within this window are checked (avoids notifying old history). */
export const MISSED_SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface MissedSessionSummary {
  classesChecked: number;
  notified: number;
  skipped: number;
  failed: number;
}

export interface MissedSessionOptions {
  force?: boolean;
}

function formatCairoTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: CAIRO_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Notifies members who booked a class with a package session and never checked in.
 * Sessions are already deducted at booking, so this only sends a push notification.
 */
export class MissedSessionService {
  /**
   * Missed session notifications are only enabled in production environments.
   * Disabled in local development, test, and testing environments by default
   * to avoid accidentally sending push notifications to members from dev/test databases.
   */
  static isNotificationEnabled(): boolean {
    if (process.env.ENABLE_MISSED_SESSION_NOTIFICATIONS === "true") return true;
    if (process.env.ENABLE_MISSED_SESSION_NOTIFICATIONS === "false") return false;
    if (process.env.DISABLE_MISSED_SESSION_NOTIFICATIONS === "true") return false;

    const nodeEnv = (process.env.NODE_ENV || "").toLowerCase().trim();
    const appEnv = (process.env.ENVIRONMENT || "").toLowerCase().trim();

    // Check for explicit dev/test environments or absence of NODE_ENV
    const isDevOrTestEnv =
      !nodeEnv ||
      nodeEnv === "development" ||
      nodeEnv === "dev" ||
      nodeEnv === "test" ||
      nodeEnv === "testing" ||
      nodeEnv === "local" ||
      appEnv === "testing" ||
      appEnv === "test" ||
      appEnv === "development" ||
      appEnv === "dev" ||
      appEnv === "local";

    if (isDevOrTestEnv) {
      return false;
    }

    // Safeguard: Check if database URI points to a test database
    const mongoUri = (process.env.MONGO_URI || "").toLowerCase();
    if (mongoUri.includes("tms_test") || mongoUri.includes("/test")) {
      return false;
    }

    return nodeEnv === "production" || nodeEnv === "prod";
  }

  static async notifyMissedSessions(
    now: Date = new Date(),
    options?: MissedSessionOptions
  ): Promise<MissedSessionSummary> {
    const summary: MissedSessionSummary = {
      classesChecked: 0,
      notified: 0,
      skipped: 0,
      failed: 0,
    };

    if (!options?.force && !this.isNotificationEnabled()) {
      logger.info(
        "Missed session notifications are disabled in development/testing environments"
      );
      return summary;
    }

    let classes;
    try {
      classes = await ScheduledClass.find({
        endTime: {
          $lte: now,
          $gte: new Date(now.getTime() - MISSED_SESSION_LOOKBACK_MS),
        },
      }).populate({ path: "cid" });
    } catch (err) {
      logger.error("Missed sessions: failed to load ended classes", { err });
      return summary;
    }

    for (const scheduledClass of classes) {
      summary.classesChecked++;
      const cls = scheduledClass.cid as any;
      if (!cls) continue;

      // Same rule as cancelBooking: free and workspace classes don't use a package session
      const classUsesPackage = cls.category !== "WORKSPACE" && cls.price != 0;
      if (!classUsesPackage) continue;

      const scid = String(scheduledClass._id);
      const className: string =
        cls.title ?? (scheduledClass as { className?: string }).className ?? "your class";

      let members;
      try {
        members = await Member.find({
          bookings: {
            $elemMatch: {
              scid: scheduledClass._id,
              missedNotifiedAt: { $exists: false },
            },
          },
        }).select("uid bookings attendance");
      } catch (err) {
        summary.failed++;
        logger.error("Missed sessions: failed to load members for class", { scid, err });
        continue;
      }

      for (const member of members) {
        const uid = String(member.uid);
        try {
          const booking = member.bookings.find((b) => String(b.scid) === scid);
          if (!booking || booking.missedNotifiedAt || booking.isDropIn) {
            summary.skipped++;
            continue;
          }

          const attended =
            member.attendance.some((a) => String(a.scid) === scid) ||
            (scheduledClass.scans ?? []).some(
              (s) => String(s.uid) === uid && s.status !== false,
            );
          if (attended) {
            summary.skipped++;
            continue;
          }

          // Claim atomically before sending so overlapping runs / instances can't double-send
          const claim = await Member.updateOne(
            {
              uid: member.uid,
              bookings: {
                $elemMatch: {
                  scid: scheduledClass._id,
                  missedNotifiedAt: { $exists: false },
                },
              },
            },
            { $set: { "bookings.$.missedNotifiedAt": now } },
          );
          if (claim.modifiedCount !== 1) {
            summary.skipped++;
            continue;
          }

          await NotificationsService.notifyUsers(
            [uid],
            "Missed Session",
            `You missed ${className} at ${formatCairoTime(scheduledClass.startTime)}. The session was counted from your package.`,
            {
              type: "MISSED_SESSION",
              scid,
              className,
              startTime: scheduledClass.startTime.toISOString(),
            },
          );
          summary.notified++;
        } catch (err) {
          summary.failed++;
          logger.error("Missed sessions: failed to notify member", { uid, scid, err });
        }
      }
    }

    logger.info("Missed session notifications run complete", summary);
    return summary;
  }
}
