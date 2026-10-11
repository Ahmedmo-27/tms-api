import { ClientSession, Types } from "mongoose";
import Member, { IMemberPackageData } from "../models/member";
import DailyAttendance from "../models/dailyAttendance";
import ScheduledClass from "../models/scheduledClass";
import Package, { isUnlimitedSpaceAccess } from "../models/package";
import User from "../models/user";
import NonUserBooking from "../models/nonUserBookings";
import Payment from "../models/payment";
import { BadRequestError, ConflictError, NotFoundError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { cairoDateKey } from "../utils/timezone";
import { resolvePackageStatus } from "./package-status-service";
import logger from "../config/logger";

/**
 * Front-desk correction of a Scans Monitor row.
 *
 * Every row is the visible half of an *effect* on a member: a credit taken off
 * a package plus an attendance record. Edits are therefore expressed as
 * "revert the old effect, apply the new one", which keeps member balances
 * consistent no matter which field the front desk changed.
 *
 * Moving a check-in to another member returns the session to the original member
 * and charges the new member across all scan sources (class, PT, open-gym).
 * Moving a scan to a new class moves attendance and adjusts credits accordingly
 * (e.g. if a member scanned a false QR code).
 */

export type ScanSource = "class" | "pt" | "open-gym";

export const SCAN_SOURCES: ScanSource[] = ["class", "pt", "open-gym"];

export function isScanSource(value: string): value is ScanSource {
  return (SCAN_SOURCES as string[]).includes(value);
}

export interface ScanRowRef {
  source: ScanSource;
  /** Scheduled class id for "class"; DailyAttendance document id otherwise. */
  parentId: string;
  /** _id of the scan subdocument inside its parent array or NonUserBooking id. */
  rowId: string;
}

export interface ScanRowChanges {
  /** Reassign the row to this member (User id). */
  uid?: string;
  /** Charge the visit to this catalog package instead. */
  pkgId?: string;
  /** Corrected check-in timestamp. */
  time?: string | Date;
  status?: "SUCCESS" | "FAILED" | "WILL_PAY";
  /** Guest rows (open gym or class walk-in) — these store their own name and phone. */
  guestName?: string;
  guestPhone?: string;
  name?: string;
  phoneNumber?: string;
  /** Move this scan to a new scheduled class (for false QR code scans). */
  targetScid?: string;
}

export interface ScanRowView {
  source: ScanSource;
  parentId: string;
  rowId: string;
  uid?: string;
  memberName?: string;
  phone?: string;
  guestName?: string;
  guestPhone?: string;
  pkgId?: string;
  method: string;
  time: Date;
  status: "SUCCESS" | "FAILED" | "WILL_PAY";
}

interface ScanEffect {
  uid?: string;
  pkgId?: string;
  status: "SUCCESS" | "FAILED" | "WILL_PAY";
  time: Date;
}

function toObjectId(value: string, field: string): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) {
    throw new BadRequestError("INVALID_ID", `${field} is not a valid id`);
  }
  return new Types.ObjectId(value);
}

/**
 * Picks which of the member's holdings of a catalog package the visit touched.
 * Prefers the holding carrying a matching adjustment near the scan time, since
 * a member can hold the same package twice; otherwise the newest holding.
 */
function pickMemberPackage(
  packages: IMemberPackageData[],
  pkgId: string,
  at?: Date,
): IMemberPackageData | undefined {
  const holdings = packages.filter((p) => p.pkgId.toString() === pkgId);
  if (holdings.length <= 1) return holdings[0];

  if (at) {
    const windowMs = 60 * 60 * 1000;
    const matched = holdings.find((p) =>
      (p.adjustmentHistory ?? []).some(
        (a) =>
          a.type === "DEDUCT" &&
          Math.abs(new Date(a.date).getTime() - at.getTime()) <= windowMs,
      ),
    );
    if (matched) return matched;
  }

  return [...holdings].sort(
    (a, b) =>
      new Date(b.pkgStartDate).getTime() - new Date(a.pkgStartDate).getTime(),
  )[0];
}

/**
 * Moves one visit's worth of credit on or off a member's package.
 * Unlimited space-access packages cost nothing per visit, so they are a no-op.
 */
async function adjustCredit(
  uid: string,
  pkgId: string,
  direction: "refund" | "charge",
  reason: string,
  session: ClientSession,
  at: Date,
): Promise<void> {
  const catalog = await Package.findById(pkgId).select("category").session(session);
  const cost = catalog && isUnlimitedSpaceAccess(catalog.category) ? 0 : 1;
  if (cost === 0) return;

  const delta = direction === "refund" ? cost : -cost;

  const member = await Member.findOne({ uid }).session(session);
  if (!member) {
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
  }
  const pkg = pickMemberPackage(member.packages, pkgId, at);
  if (!pkg) {
    throw new NotFoundError(
      "PACKAGE_NOT_FOUND",
      "This member does not hold that package",
    );
  }
  if (delta < 0 && pkg.remainingClasses + delta < 0) {
    throw new BadRequestError(
      "NO_REMAINING_SESSIONS",
      `"${pkg.name}" has no sessions left to charge`,
    );
  }

  pkg.remainingClasses += delta;
  (pkg.adjustmentHistory ??= []).push({
    date: new Date(),
    source: "ADMIN",
    type: delta > 0 ? "ADD" : "DEDUCT",
    amount: Math.abs(delta),
    className: pkg.name,
    attendanceDate: at,
    reason,
  });

  // A returned credit can lift the package out of COMPLETED, and a charge can
  // push it in, so re-derive the status rather than leaving it stale.
  pkg.status = resolvePackageStatus(pkg, new Date(), catalog?.category);

  await member.save({ session });
}

/** Reverses what a SUCCESS row did to the member's balance and attendance. */
async function revertEffect(
  source: ScanSource,
  effect: ScanEffect,
  session: ClientSession,
  parentId: string,
): Promise<void> {
  if (effect.status !== "SUCCESS" || !effect.uid) return;

  if (source === "class") {
    await Member.updateOne(
      { uid: effect.uid },
      { $pull: { attendance: { scid: new Types.ObjectId(parentId) } } },
      { session },
    );

    await ScheduledClass.updateOne(
      { _id: new Types.ObjectId(parentId) },
      { $pull: { bookedMembers: { uid: new Types.ObjectId(effect.uid) } } },
      { session },
    );

    await Member.updateOne(
      { uid: effect.uid },
      { $pull: { bookings: { scid: new Types.ObjectId(parentId) } } },
      { session },
    );

    let pkgIdToRefund = effect.pkgId;
    if (!pkgIdToRefund) {
      const scheduledClass = await ScheduledClass.findById(parentId).session(session);
      const booked = (scheduledClass?.bookedMembers ?? []).find(
        (b: any) => b.uid?.toString() === effect.uid,
      );
      if (booked?.method) {
        pkgIdToRefund = await resolveLegacyPkgId(booked.method, session);
      }
      if (!pkgIdToRefund && scheduledClass?.cid) {
        const validPkgs = await Package.find({ opensClasses: scheduledClass.cid }).session(session);
        const validIds = new Set(validPkgs.map((p) => p._id.toString()));
        const member = await Member.findOne({ uid: effect.uid }).session(session);
        const holding = (member?.packages ?? []).find((p) =>
          validIds.has(p.pkgId.toString()),
        );
        if (holding) {
          pkgIdToRefund = holding.pkgId.toString();
        }
      }
    }

    if (pkgIdToRefund) {
      try {
        await adjustCredit(
          effect.uid,
          pkgIdToRefund,
          "refund",
          "Scan corrected by front desk — session returned",
          session,
          effect.time,
        );
      } catch (err) {
        logger.warn(
          `[ScanAdmin] Could not refund credit for member ${effect.uid} package ${pkgIdToRefund}:`,
          err,
        );
      }
    }
    return;
  }

  if (effect.pkgId) {
    await adjustCredit(
      effect.uid,
      effect.pkgId,
      "refund",
      "Scan corrected by front desk — session returned",
      session,
      effect.time,
    );
  }

  if (source === "pt") {
    // Keyed on the package where known; a row whose package could not be
    // resolved falls back to the day, so the member is not left blocked from
    // re-scanning by a stale entry.
    await Member.updateOne(
      { uid: effect.uid },
      {
        $pull: {
          ptAttendance: {
            ...(effect.pkgId ? { pkgId: new Types.ObjectId(effect.pkgId) } : {}),
            date: cairoDateKey(effect.time),
          },
        },
      },
      { session },
    );
  }
}

/** Applies the row's new state to the member's balance and attendance. */
async function applyEffect(
  source: ScanSource,
  effect: ScanEffect,
  session: ClientSession,
  parentId: string,
): Promise<void> {
  if (effect.status !== "SUCCESS" || !effect.uid) return;

  if (source === "class") {
    await Member.updateOne(
      {
        uid: effect.uid,
        "attendance.scid": { $ne: new Types.ObjectId(parentId) },
      },
      {
        $push: {
          attendance: {
            scid: new Types.ObjectId(parentId),
            date: effect.time,
          },
        },
      },
      { session },
    );

    const scheduledClass = await ScheduledClass.findById(parentId).session(session);
    const isAlreadyBooked = (scheduledClass?.bookedMembers ?? []).some(
      (b: any) => b.uid?.toString() === effect.uid,
    );

    if (!isAlreadyBooked) {
      let pkgIdToCharge = effect.pkgId;
      if (!pkgIdToCharge && scheduledClass?.cid) {
        const validPkgs = await Package.find({ opensClasses: scheduledClass.cid }).session(session);
        const validIds = new Set(validPkgs.map((p) => p._id.toString()));
        const member = await Member.findOne({ uid: effect.uid }).session(session);
        const holding = (member?.packages ?? []).find(
          (p) =>
            validIds.has(p.pkgId.toString()) &&
            p.status === "ACTIVE" &&
            p.remainingClasses > 0,
        );
        if (holding) {
          pkgIdToCharge = holding.pkgId.toString();
        }
      }

      if (pkgIdToCharge) {
        await adjustCredit(
          effect.uid,
          pkgIdToCharge,
          "charge",
          "Scan corrected by front desk — session charged",
          session,
          effect.time,
        );

        const catalog = await Package.findById(pkgIdToCharge)
          .select("name")
          .session(session);
        const methodName = catalog?.name || "Class Package";

        await ScheduledClass.bookMember(
          parentId,
          effect.uid,
          methodName,
          session,
          true,
        );

        await Member.updateOne(
          {
            uid: effect.uid,
            "bookings.scid": { $ne: new Types.ObjectId(parentId) },
          },
          {
            $push: {
              bookings: {
                scid: new Types.ObjectId(parentId),
                cid: scheduledClass?.cid,
              },
            },
          },
          { session },
        );
      }
    }
    return;
  }

  if (effect.pkgId) {
    await adjustCredit(
      effect.uid,
      effect.pkgId,
      "charge",
      "Scan corrected by front desk — session charged",
      session,
      effect.time,
    );
  }

  if (source === "pt" && effect.pkgId) {
    await Member.updateOne(
      { uid: effect.uid },
      {
        $push: {
          ptAttendance: {
            pkgId: new Types.ObjectId(effect.pkgId),
            attendanceTime: effect.time,
            date: cairoDateKey(effect.time),
          },
        },
      },
      { session },
    );
  }
}

/**
 * Rows written before `pkgId` was stored only carry the package's name in
 * `method`. Resolving it keeps corrections on historical rows able to move the
 * credit instead of silently skipping the refund.
 */
async function resolveLegacyPkgId(
  method: string | undefined,
  session: ClientSession,
): Promise<string | undefined> {
  if (!method) return undefined;
  const catalog = await Package.findOne({ name: method })
    .select("_id")
    .session(session);
  return catalog?._id?.toString();
}

type RowDoc = Record<string, any>;

interface LoadedRow {
  parent: any;
  row: RowDoc;
  arrayPath: string;
  isNonUserBooking?: boolean;
}

/** Locates the parent document and the subdocument array holding the row. */
async function loadRow(
  ref: ScanRowRef,
  session?: ClientSession,
): Promise<LoadedRow> {
  const parentId = toObjectId(ref.parentId, "parentId");
  toObjectId(ref.rowId, "rowId");

  if (ref.source === "class") {
    const parent = await ScheduledClass.findById(parentId).session(session ?? null);
    if (!parent) {
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled class not found");
    }
    const row =
      typeof (parent.scans as any)?.id === "function"
        ? (parent.scans as any).id(ref.rowId)
        : (parent.scans as any[])?.find((s: any) => s._id?.toString() === ref.rowId);
    if (row) {
      return { parent, row, arrayPath: "scans", isNonUserBooking: false };
    }
    const nonUser = await NonUserBooking.findById(ref.rowId).session(session ?? null);
    if (nonUser) {
      return { parent, row: nonUser, arrayPath: "scans", isNonUserBooking: true };
    }
    throw new NotFoundError("SCAN_NOT_FOUND", "Scan row not found");
  }

  const parent = await DailyAttendance.findById(parentId).session(session ?? null);
  if (!parent) {
    throw new NotFoundError("ATTENDANCE_NOT_FOUND", "Attendance day not found");
  }
  const arrayPath = ref.source === "pt" ? "ptAttendance" : "openGymAttendance";
  const row =
    typeof (parent[arrayPath] as any)?.id === "function"
      ? (parent[arrayPath] as any).id(ref.rowId)
      : (parent[arrayPath] as any[])?.find((s: any) => s._id?.toString() === ref.rowId);
  if (!row) throw new NotFoundError("SCAN_NOT_FOUND", "Scan row not found");
  return { parent, row, arrayPath, isNonUserBooking: false };
}

/** Class rows store status as boolean or 'WILL_PAY'; daily arrays use string enum; NonUserBooking uses its own status enum. */
function readStatus(
  source: ScanSource,
  row: RowDoc,
  isNonUserBooking?: boolean,
): "SUCCESS" | "FAILED" | "WILL_PAY" {
  if (isNonUserBooking) {
    if (row.status === "PAID") return "SUCCESS";
    if (row.status === "CANCELLED") return "FAILED";
    return "WILL_PAY";
  }
  if (row.status === "WILL_PAY") return "WILL_PAY";
  if (source === "class") return row.status === false ? "FAILED" : "SUCCESS";
  return row.status === "FAILED" ? "FAILED" : "SUCCESS";
}

function writeStatus(
  source: ScanSource,
  row: RowDoc,
  status: "SUCCESS" | "FAILED" | "WILL_PAY",
  isNonUserBooking?: boolean,
): void {
  if (isNonUserBooking) {
    if (status === "SUCCESS") row.status = "PAID";
    else if (status === "FAILED") row.status = "CANCELLED";
    else row.status = "ATTENDED";
    return;
  }
  if (status === "WILL_PAY") {
    row.status = "WILL_PAY";
  } else if (source === "class") {
    row.status = status === "SUCCESS";
  } else {
    row.status = status;
  }
}

function readTime(
  source: ScanSource,
  row: RowDoc,
  isNonUserBooking?: boolean,
): Date {
  if (isNonUserBooking) {
    return new Date(row.attendanceTime || row.bookingTime || Date.now());
  }
  return new Date(source === "class" ? row.scanTime : row.time);
}

function writeTime(
  source: ScanSource,
  row: RowDoc,
  time: Date,
  isNonUserBooking?: boolean,
): void {
  if (isNonUserBooking) {
    row.attendanceTime = time;
    return;
  }
  if (source === "class") row.scanTime = time;
  else row.time = time;
}

export class ScanAdminService {
  /**
   * Deletes a scan row. A SUCCESS row's effect is reverted first, so a member
   * who was scanned by mistake gets the session back.
   */
  static async deleteScanRow(
    ref: ScanRowRef,
    options: { restoreSession?: boolean } = {},
  ): Promise<void> {
    const restoreSession = options.restoreSession !== false;

    await runInTransaction(async (session: ClientSession) => {
      const { parent, row, arrayPath, isNonUserBooking } = await loadRow(ref, session);

      if (isNonUserBooking) {
        if (row.status !== "CANCELLED") {
          await NonUserBooking.cancelBooking(ref.rowId, session);
          await ScheduledClass.removeBookedNonUser(ref.parentId, session);
        }
        return;
      }

      const effect: ScanEffect = {
        uid: row.uid?.toString(),
        pkgId:
          row.pkgId?.toString() ??
          (await resolveLegacyPkgId(row.method, session)),
        status: readStatus(ref.source, row, false),
        time: readTime(ref.source, row, false),
      };

      if (restoreSession) {
        await revertEffect(ref.source, effect, session, ref.parentId);
      } else if (ref.source === "class" && effect.uid) {
        // restoreSession=false keeps booking/charges intact, but clears attendance
        await Member.updateOne(
          { uid: effect.uid },
          { $pull: { attendance: { scid: new Types.ObjectId(ref.parentId) } } },
          { session },
        );
      }

      (parent[arrayPath] as any).pull({ _id: new Types.ObjectId(ref.rowId) });
      await parent.save({ session });
    });

    logger.info(
      `[ScanAdmin] Deleted ${ref.source} scan ${ref.rowId} (parent ${ref.parentId})`,
    );
  }

  /**
   * Edits a scan row. Changing the member, the package or the status moves the
   * credit accordingly; changing only the time or guest details does not.
   * Passing targetScid moves the check-in to that scheduled class.
   */
  static async updateScanRow(
    ref: ScanRowRef,
    changes: ScanRowChanges,
  ): Promise<ScanRowView> {
    if (changes.targetScid && changes.targetScid !== ref.parentId) {
      return ScanAdminService.moveScanToClass(ref, changes.targetScid, {
        uid: changes.uid,
        pkgId: changes.pkgId,
        time: changes.time,
        status: changes.status,
        guestName: changes.guestName,
        guestPhone: changes.guestPhone,
        name: changes.name,
        phoneNumber: changes.phoneNumber,
      });
    }

    if (ref.source === "pt" && (changes.guestName || changes.guestPhone)) {
      throw new BadRequestError(
        "GUEST_FIELDS_NOT_SUPPORTED",
        "Guest name and phone can only be set on open gym or class walk-in rows",
      );
    }

    await runInTransaction(async (session: ClientSession) => {
      const { parent, row, arrayPath, isNonUserBooking } = await loadRow(ref, session);

      if (isNonUserBooking) {
        if (changes.uid) {
          if (row.status !== "CANCELLED") {
            await NonUserBooking.cancelBooking(ref.rowId, session);
            await ScheduledClass.removeBookedNonUser(ref.parentId, session);
          }

          const user = await User.findById(toObjectId(changes.uid, "uid"))
            .select("_id")
            .session(session);
          if (!user) throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");

          const targetStatus = changes.status ?? (row.status === "PAID" ? "SUCCESS" : "WILL_PAY");
          const scanTime = changes.time ? new Date(changes.time) : readTime(ref.source, row, true);
          if (isNaN(scanTime.getTime())) {
            throw new BadRequestError("INVALID_TIME", "Check-in time is not a valid date");
          }

          let pkgIdToUse = changes.pkgId;
          let methodName = "Walk In";

          if (targetStatus === "SUCCESS") {
            const isBooked = (parent.bookedMembers ?? []).some(
              (b: RowDoc) => b.uid?.toString() === changes.uid,
            );
            if (!isBooked) {
              if (!pkgIdToUse && parent.cid) {
                const validPkgs = await Package.find({ opensClasses: parent.cid }).session(session);
                const validIds = new Set(validPkgs.map((p) => p._id.toString()));
                const memberDoc = await Member.findOne({ uid: changes.uid }).session(session);
                const eligibleHoldings = (memberDoc?.packages ?? []).filter(
                  (p) =>
                    validIds.has(p.pkgId.toString()) &&
                    p.status === "ACTIVE" &&
                    p.remainingClasses > 0,
                );
                if (eligibleHoldings.length === 1) {
                  pkgIdToUse = eligibleHoldings[0].pkgId.toString();
                } else {
                  throw new BadRequestError(
                    "PACKAGE_REQUIRED",
                    "Choose which of the member's packages to charge",
                  );
                }
              }

              if (pkgIdToUse) {
                const catalog = await Package.findById(pkgIdToUse)
                  .select("name opensClasses")
                  .session(session);
                if (!catalog) {
                  throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
                }
                methodName = catalog.name;

                await adjustCredit(
                  changes.uid,
                  pkgIdToUse,
                  "charge",
                  "Walk-in assigned to member — session charged",
                  session,
                  scanTime,
                );

                await ScheduledClass.bookMember(
                  ref.parentId,
                  changes.uid,
                  methodName,
                  session,
                  true,
                );

                await Member.updateOne(
                  {
                    uid: changes.uid,
                    "bookings.scid": { $ne: new Types.ObjectId(ref.parentId) },
                  },
                  {
                    $push: {
                      bookings: {
                        scid: new Types.ObjectId(ref.parentId),
                        cid: parent.cid,
                      },
                    },
                  },
                  { session },
                );
              }
            }

            await Member.updateOne(
              {
                uid: changes.uid,
                "attendance.scid": { $ne: new Types.ObjectId(ref.parentId) },
              },
              {
                $push: {
                  attendance: {
                    scid: new Types.ObjectId(ref.parentId),
                    date: scanTime,
                  },
                },
              },
              { session },
            );
          }

          const newScanId = new Types.ObjectId();
          (parent.scans as any).push({
            _id: newScanId,
            uid: user._id,
            scanTime,
            method: methodName,
            status: targetStatus === "WILL_PAY" ? "WILL_PAY" : targetStatus === "SUCCESS",
            pkgId: pkgIdToUse ? new Types.ObjectId(pkgIdToUse) : undefined,
          });

          await parent.save({ session });
          ref.rowId = newScanId.toString();
          return;
        }

        const effectiveName = changes.guestName ?? changes.name;
        const effectivePhone = changes.guestPhone ?? changes.phoneNumber;

        if (effectiveName !== undefined) {
          row.name = effectiveName;
          if (row.paymentId) {
            await Payment.findByIdAndUpdate(row.paymentId, {
              nonMemberName: effectiveName,
            }).session(session);
          }
        }
        if (effectivePhone !== undefined) {
          row.phoneNumber = effectivePhone;
          if (row.paymentId) {
            await Payment.findByIdAndUpdate(row.paymentId, {
              nonMemberPhone: effectivePhone,
            }).session(session);
          }
        }
        if (changes.time) row.attendanceTime = new Date(changes.time);

        if (changes.status) {
          const oldStatus = row.status;
          const newStatus =
            changes.status === "SUCCESS"
              ? "PAID"
              : changes.status === "FAILED"
              ? "CANCELLED"
              : "ATTENDED";

          if (newStatus !== oldStatus) {
            if (newStatus === "CANCELLED" && oldStatus !== "CANCELLED") {
              await ScheduledClass.removeBookedNonUser(ref.parentId, session);
            } else if (oldStatus === "CANCELLED" && newStatus !== "CANCELLED") {
              await ScheduledClass.bookNonUser(ref.parentId, session, true);
            }
            row.status = newStatus;
          }
        }

        await row.save({ session });
        return;
      }

      const before: ScanEffect = {
        uid: row.uid?.toString(),
        pkgId:
          row.pkgId?.toString() ??
          (await resolveLegacyPkgId(row.method, session)),
        status: readStatus(ref.source, row, false),
        time: readTime(ref.source, row, false),
      };

      const after: ScanEffect = {
        uid: changes.uid ?? before.uid,
        pkgId: changes.pkgId ?? (changes.uid ? undefined : before.pkgId),
        status: changes.status ?? before.status,
        time: changes.time ? new Date(changes.time) : before.time,
      };

      if (changes.uid && !changes.pkgId) {
        if (ref.source === "class") {
          const isBooked = (parent.bookedMembers ?? []).some(
            (b: RowDoc) => b.uid?.toString() === changes.uid,
          );
          if (!isBooked) {
            const memberDoc = await Member.findOne({ uid: changes.uid }).session(session);
            const validPkgs = parent.cid
              ? await Package.find({ opensClasses: parent.cid }).session(session)
              : [];
            const validIds = new Set(validPkgs.map((p) => p._id.toString()));
            const eligibleHoldings = (memberDoc?.packages ?? []).filter(
              (p) =>
                validIds.has(p.pkgId.toString()) &&
                p.status === "ACTIVE" &&
                p.remainingClasses > 0,
            );
            if (eligibleHoldings.length === 1) {
              changes.pkgId = eligibleHoldings[0].pkgId.toString();
              after.pkgId = changes.pkgId;
            } else {
              throw new BadRequestError(
                "PACKAGE_REQUIRED",
                "Choose which of the new member's packages to charge",
              );
            }
          }
        } else {
          throw new BadRequestError(
            "PACKAGE_REQUIRED",
            "Choose which of the new member's packages to charge",
          );
        }
      }

      if (after.time && isNaN(after.time.getTime())) {
        throw new BadRequestError("INVALID_TIME", "Check-in time is not a valid date");
      }

      if (after.pkgId && (after.pkgId !== before.pkgId || changes.uid)) {
        const catalog = await Package.findById(after.pkgId)
          .select("name opensClasses")
          .session(session);
        if (!catalog) {
          throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
        }
        if (
          ref.source === "class" &&
          parent.cid &&
          catalog.opensClasses &&
          catalog.opensClasses.length > 0 &&
          !catalog.opensClasses.some(
            (c: any) => (c._id?.toString() || c.toString()) === parent.cid.toString(),
          )
        ) {
          throw new BadRequestError(
            "PACKAGE_NOT_ELIGIBLE",
            "Selected package does not cover this class",
          );
        }
      }

      const effectChanged =
        before.uid !== after.uid ||
        before.pkgId !== after.pkgId ||
        before.status !== after.status;

      if (effectChanged) {
        await revertEffect(ref.source, before, session, ref.parentId);
        await applyEffect(ref.source, after, session, ref.parentId);
      }

      if (changes.uid) {
        const user = await User.findById(toObjectId(changes.uid, "uid"))
          .select("_id")
          .session(session);
        if (!user) throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
        row.uid = user._id;
        row.pkgId = after.pkgId ? new Types.ObjectId(after.pkgId) : undefined;
        row.guestName = undefined;
        row.guestPhone = undefined;
      }

      if (after.pkgId && (after.pkgId !== before.pkgId || changes.uid)) {
        const catalog = await Package.findById(after.pkgId)
          .select("name")
          .session(session);
        if (catalog) {
          row.pkgId = catalog._id;
          row.method = catalog.name;

          // Keep the class roster's label in step with the corrected row.
          if (ref.source === "class" && after.uid) {
            const booked = (parent.bookedMembers ?? []).find(
              (b: RowDoc) => b.uid?.toString() === after.uid,
            );
            if (booked) booked.method = catalog.name;
          }
        }
      }

      if (changes.time) writeTime(ref.source, row, after.time, false);
      if (changes.status) writeStatus(ref.source, row, after.status, false);
      if (changes.guestName !== undefined) row.guestName = changes.guestName;
      if (changes.guestPhone !== undefined) row.guestPhone = changes.guestPhone;

      await parent.save({ session });
    });

    logger.info(
      `[ScanAdmin] Updated ${ref.source} scan ${ref.rowId} (parent ${ref.parentId})`,
    );

    return ScanAdminService.getScanRow(ref);
  }

  /**
   * Moves a member's check-in to a new scheduled class (e.g. if the member scanned a false QR code).
   * Reverts the effect from the false class (session returned, attendance removed)
   * and applies the check-in to the target class (session charged if not already booked, attendance added).
   */
  static async moveScanToClass(
    ref: ScanRowRef,
    targetScid: string,
    options: {
      uid?: string;
      pkgId?: string;
      time?: string | Date;
      status?: "SUCCESS" | "FAILED" | "WILL_PAY";
      guestName?: string;
      guestPhone?: string;
      name?: string;
      phoneNumber?: string;
    } = {},
  ): Promise<ScanRowView> {
    const targetObjectId = toObjectId(targetScid, "targetScid");
    const parentObjectId = toObjectId(ref.parentId, "parentId");
    toObjectId(ref.rowId, "rowId");

    if (ref.source === "class" && parentObjectId.equals(targetObjectId)) {
      throw new BadRequestError("SAME_CLASS", "Cannot move check-in to the same class");
    }

    let newRowId: Types.ObjectId | undefined;

    await runInTransaction(async (session: ClientSession) => {
      const targetClass = await ScheduledClass.findById(targetObjectId).session(session);
      if (!targetClass) {
        throw new NotFoundError("CLASS_NOT_FOUND", "Target scheduled class not found");
      }

      const { parent: oldParent, row, arrayPath, isNonUserBooking } = await loadRow(ref, session);

      if (isNonUserBooking) {
        if (row.status !== "CANCELLED") {
          await ScheduledClass.removeBookedNonUser(ref.parentId, session);
        }

        const targetUid = options.uid;
        if (!targetUid) {
          // Moving walk-in to new class as walk-in
          if (row.status !== "CANCELLED") {
            await ScheduledClass.bookNonUser(targetScid, session, true);
          }
          row.scid = targetObjectId;
          const effectiveName = options.guestName ?? options.name;
          const effectivePhone = options.guestPhone ?? options.phoneNumber;
          if (effectiveName !== undefined) {
            row.name = effectiveName;
            if (row.paymentId) {
              await Payment.findByIdAndUpdate(row.paymentId, {
                nonMemberName: effectiveName,
              }).session(session);
            }
          }
          if (effectivePhone !== undefined) {
            row.phoneNumber = effectivePhone;
            if (row.paymentId) {
              await Payment.findByIdAndUpdate(row.paymentId, {
                nonMemberPhone: effectivePhone,
              }).session(session);
            }
          }
          if (options.time) row.attendanceTime = new Date(options.time);
          if (options.status) {
            row.status =
              options.status === "SUCCESS"
                ? "PAID"
                : options.status === "FAILED"
                ? "CANCELLED"
                : "ATTENDED";
          }
          await row.save({ session });
          newRowId = row._id;
          return;
        }

        // Converting walk-in to member in target class
        await NonUserBooking.cancelBooking(ref.rowId, session);
      }

      const oldUid = row.uid?.toString();
      const targetUid = options.uid ?? oldUid;
      if (!targetUid) {
        throw new BadRequestError(
          "MEMBER_REQUIRED",
          "Guest check-ins cannot be moved to a class without specifying a member",
        );
      }

      const scanTime = options.time
        ? new Date(options.time)
        : readTime(ref.source, row, isNonUserBooking);
      if (isNaN(scanTime.getTime())) {
        throw new BadRequestError("INVALID_TIME", "Check-in time is not a valid date");
      }

      const targetStatus = options.status ?? "SUCCESS";

      // Check if target member already has a SUCCESS scan in target class
      if (targetStatus === "SUCCESS") {
        const alreadyScanned = (targetClass.scans ?? []).some(
          (s: RowDoc) => s.uid?.toString() === targetUid && s.status !== false,
        );
        if (alreadyScanned) {
          throw new ConflictError(
            "CLASS_ALREADY_SCANNED",
            "Member is already checked in to target class",
          );
        }
      }

      // 1. Revert effect from false class / old check-in
      if (oldUid) {
        const beforeEffect: ScanEffect = {
          uid: oldUid,
          pkgId:
            row.pkgId?.toString() ??
            (await resolveLegacyPkgId(row.method, session)),
          status: readStatus(ref.source, row, false),
          time: readTime(ref.source, row, false),
        };

        await revertEffect(ref.source, beforeEffect, session, ref.parentId);
      }

      // Remove row from old parent if not walk-in
      if (!isNonUserBooking) {
        (oldParent[arrayPath] as any).pull({ _id: new Types.ObjectId(ref.rowId) });
        await oldParent.save({ session });
      }

      // 2. Apply check-in to target class
      let targetPkgId = options.pkgId;
      let targetMethod = isNonUserBooking ? "Walk In" : (row.method || "Class Scan");

      // Validate target package if provided
      if (targetPkgId) {
        const catalog = await Package.findById(targetPkgId).session(session);
        if (!catalog) {
          throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
        }
        if (
          targetClass.cid &&
          catalog.opensClasses &&
          catalog.opensClasses.length > 0 &&
          !catalog.opensClasses.some(
            (c: any) => (c._id?.toString() || c.toString()) === targetClass.cid.toString(),
          )
        ) {
          throw new BadRequestError(
            "PACKAGE_NOT_ELIGIBLE",
            "Selected package does not cover this class",
          );
        }
        targetMethod = catalog.name;
      }

      if (targetStatus === "SUCCESS") {
        const isBookedInTarget = (targetClass.bookedMembers ?? []).some(
          (b: RowDoc) => b.uid?.toString() === targetUid,
        );

        if (!isBookedInTarget) {
          if (!targetPkgId && targetClass.cid) {
            const validPkgs = await Package.find({ opensClasses: targetClass.cid }).session(session);
            const validIds = new Set(validPkgs.map((p) => p._id.toString()));
            const memberDoc = await Member.findOne({ uid: targetUid }).session(session);
            const candidate = (memberDoc?.packages ?? []).find(
              (p) =>
                validIds.has(p.pkgId.toString()) &&
                p.status === "ACTIVE" &&
                p.remainingClasses > 0,
            );
            if (candidate) {
              targetPkgId = candidate.pkgId.toString();
              const cat = validPkgs.find((p) => p._id.toString() === targetPkgId);
              if (cat) targetMethod = cat.name;
            } else {
              throw new BadRequestError(
                "PACKAGE_REQUIRED",
                "Choose which package to charge for the new class",
              );
            }
          }

          if (targetPkgId) {
            await adjustCredit(
              targetUid,
              targetPkgId,
              "charge",
              "Scan moved from false QR code — session charged",
              session,
              scanTime,
            );

            await ScheduledClass.bookMember(
              targetScid,
              targetUid,
              targetMethod,
              session,
              true,
            );

            await Member.updateOne(
              {
                uid: targetUid,
                "bookings.scid": { $ne: targetObjectId },
              },
              {
                $push: {
                  bookings: {
                    scid: targetObjectId,
                    cid: targetClass.cid,
                  },
                },
              },
              { session },
            );
          }
        } else {
          const booking = (targetClass.bookedMembers ?? []).find(
            (b: RowDoc) => b.uid?.toString() === targetUid,
          );
          if (booking?.method) targetMethod = booking.method;
          if (!targetPkgId && booking?.method) {
            targetPkgId = await resolveLegacyPkgId(booking.method, session);
          }
        }

        // Mark attendance in Member
        await Member.updateOne(
          {
            uid: targetUid,
            "attendance.scid": { $ne: targetObjectId },
          },
          {
            $push: {
              attendance: {
                scid: targetObjectId,
                date: scanTime,
              },
            },
          },
          { session },
        );
      }

      // Add scan row into targetClass.scans
      newRowId = new Types.ObjectId();
      (targetClass.scans as any).push({
        _id: newRowId,
        uid: new Types.ObjectId(targetUid),
        scanTime,
        method: targetMethod,
        status: targetStatus === "WILL_PAY" ? "WILL_PAY" : targetStatus === "SUCCESS",
        pkgId: targetPkgId ? new Types.ObjectId(targetPkgId) : undefined,
      });

      await targetClass.save({ session });
    });

    logger.info(
      `[ScanAdmin] Moved scan ${ref.rowId} from ${ref.source} (${ref.parentId}) to class ${targetScid} (new row ${newRowId})`,
    );

    return ScanAdminService.getScanRow({
      source: "class",
      parentId: targetScid,
      rowId: newRowId!.toString(),
    });
  }

  /** Reads back a single row, with the member's current name and phone. */
  static async getScanRow(ref: ScanRowRef): Promise<ScanRowView> {
    const { row, isNonUserBooking } = await loadRow(ref);
    const uid = row.uid?.toString();

    let memberName: string | undefined;
    let phone: string | undefined;
    if (uid) {
      const user = await User.findById(uid).select("name phoneNumber");
      memberName = user?.name;
      phone = user?.phoneNumber;
    }

    const guestName = isNonUserBooking ? row.name : row.guestName;
    const guestPhone = isNonUserBooking ? row.phoneNumber : row.guestPhone;

    return {
      source: ref.source,
      parentId: ref.parentId,
      rowId: ref.rowId,
      uid,
      memberName: memberName ?? (isNonUserBooking ? row.name : undefined),
      phone: phone ?? (isNonUserBooking ? row.phoneNumber : undefined),
      guestName,
      guestPhone,
      pkgId: row.pkgId?.toString(),
      method: isNonUserBooking ? "Walk In" : row.method,
      time: readTime(ref.source, row, isNonUserBooking),
      status: readStatus(ref.source, row, isNonUserBooking),
    };
  }
}
