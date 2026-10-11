import { ClientSession, Types } from "mongoose";
import Member, { IMemberPackageData } from "../models/member";
import DailyAttendance from "../models/dailyAttendance";
import ScheduledClass from "../models/scheduledClass";
import Package, { isUnlimitedSpaceAccess } from "../models/package";
import User from "../models/user";
import { BadRequestError, NotFoundError } from "../core/ApiError";
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
 * Classes are the exception: their credit is spent at booking time, not at
 * check-in, so a class row's effect is the attendance record alone and the
 * booking keeps its credit until the booking itself is cancelled.
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
  /** _id of the scan subdocument inside its parent array. */
  rowId: string;
}

export interface ScanRowChanges {
  /** Reassign the row to this member (User id). */
  uid?: string;
  /** Charge the visit to this catalog package instead. */
  pkgId?: string;
  /** Corrected check-in timestamp. */
  time?: string | Date;
  status?: "SUCCESS" | "FAILED";
  /** Open gym guest rows only — these store their own name and phone. */
  guestName?: string;
  guestPhone?: string;
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
  status: "SUCCESS" | "FAILED";
}

interface ScanEffect {
  uid?: string;
  pkgId?: string;
  status: "SUCCESS" | "FAILED";
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
    // The booking keeps its credit; only the attendance mark is undone.
    await Member.updateOne(
      { uid: effect.uid },
      { $pull: { attendance: { scid: new Types.ObjectId(parentId) } } },
      { session },
    );
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
      { $push: { attendance: { scid: new Types.ObjectId(parentId) } } },
      { session },
    );
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

/** Locates the parent document and the subdocument array holding the row. */
async function loadRow(
  ref: ScanRowRef,
  session?: ClientSession,
): Promise<{ parent: any; row: RowDoc; arrayPath: string }> {
  const parentId = toObjectId(ref.parentId, "parentId");
  toObjectId(ref.rowId, "rowId");

  if (ref.source === "class") {
    const parent = await ScheduledClass.findById(parentId).session(session ?? null);
    if (!parent) {
      throw new NotFoundError("CLASS_NOT_FOUND", "Scheduled class not found");
    }
    const row = (parent.scans as any).id(ref.rowId);
    if (!row) throw new NotFoundError("SCAN_NOT_FOUND", "Scan row not found");
    return { parent, row, arrayPath: "scans" };
  }

  const parent = await DailyAttendance.findById(parentId).session(session ?? null);
  if (!parent) {
    throw new NotFoundError("ATTENDANCE_NOT_FOUND", "Attendance day not found");
  }
  const arrayPath = ref.source === "pt" ? "ptAttendance" : "openGymAttendance";
  const row = (parent[arrayPath] as any).id(ref.rowId);
  if (!row) throw new NotFoundError("SCAN_NOT_FOUND", "Scan row not found");
  return { parent, row, arrayPath };
}

/** Class rows store status as a boolean; the daily arrays use a string enum. */
function readStatus(source: ScanSource, row: RowDoc): "SUCCESS" | "FAILED" {
  if (source === "class") return row.status === false ? "FAILED" : "SUCCESS";
  return row.status === "FAILED" ? "FAILED" : "SUCCESS";
}

function writeStatus(
  source: ScanSource,
  row: RowDoc,
  status: "SUCCESS" | "FAILED",
): void {
  row.status = source === "class" ? status === "SUCCESS" : status;
}

function readTime(source: ScanSource, row: RowDoc): Date {
  return new Date(source === "class" ? row.scanTime : row.time);
}

function writeTime(source: ScanSource, row: RowDoc, time: Date): void {
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
      const { parent, row, arrayPath } = await loadRow(ref, session);
      const effect: ScanEffect = {
        uid: row.uid?.toString(),
        pkgId:
          row.pkgId?.toString() ??
          (await resolveLegacyPkgId(row.method, session)),
        status: readStatus(ref.source, row),
        time: readTime(ref.source, row),
      };

      if (restoreSession) {
        await revertEffect(ref.source, effect, session, ref.parentId);
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
   */
  static async updateScanRow(
    ref: ScanRowRef,
    changes: ScanRowChanges,
  ): Promise<ScanRowView> {
    if (ref.source !== "open-gym" && (changes.guestName || changes.guestPhone)) {
      throw new BadRequestError(
        "GUEST_FIELDS_NOT_SUPPORTED",
        "Guest name and phone can only be set on open gym rows",
      );
    }

    await runInTransaction(async (session: ClientSession) => {
      const { parent, row, arrayPath } = await loadRow(ref, session);

      const before: ScanEffect = {
        uid: row.uid?.toString(),
        pkgId:
          row.pkgId?.toString() ??
          (await resolveLegacyPkgId(row.method, session)),
        status: readStatus(ref.source, row),
        time: readTime(ref.source, row),
      };

      const after: ScanEffect = {
        uid: changes.uid ?? before.uid,
        pkgId: changes.pkgId ?? (changes.uid ? undefined : before.pkgId),
        status: changes.status ?? before.status,
        time: changes.time ? new Date(changes.time) : before.time,
      };

      if (changes.uid && !changes.pkgId && ref.source !== "class") {
        throw new BadRequestError(
          "PACKAGE_REQUIRED",
          "Choose which of the new member's packages to charge",
        );
      }
      if (after.time && isNaN(after.time.getTime())) {
        throw new BadRequestError("INVALID_TIME", "Check-in time is not a valid date");
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
        // The old member's package is meaningless on the new member's row.
        if (!changes.pkgId) row.pkgId = undefined;
        // A reassigned row belongs to a member, not a guest.
        if (ref.source === "open-gym") {
          row.guestName = undefined;
          row.guestPhone = undefined;
        }
      }

      if (after.pkgId && after.pkgId !== before.pkgId) {
        const catalog = await Package.findById(after.pkgId)
          .select("name")
          .session(session);
        if (!catalog) {
          throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
        }
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

      if (changes.time) writeTime(ref.source, row, after.time);
      if (changes.status) writeStatus(ref.source, row, after.status);
      if (changes.guestName !== undefined) row.guestName = changes.guestName;
      if (changes.guestPhone !== undefined) row.guestPhone = changes.guestPhone;

      await parent.save({ session });
    });

    logger.info(
      `[ScanAdmin] Updated ${ref.source} scan ${ref.rowId} (parent ${ref.parentId})`,
    );

    return ScanAdminService.getScanRow(ref);
  }

  /** Reads back a single row, with the member's current name and phone. */
  static async getScanRow(ref: ScanRowRef): Promise<ScanRowView> {
    const { row } = await loadRow(ref);
    const uid = row.uid?.toString();

    let memberName: string | undefined;
    let phone: string | undefined;
    if (uid) {
      const user = await User.findById(uid).select("name phoneNumber");
      memberName = user?.name;
      phone = user?.phoneNumber;
    }

    return {
      source: ref.source,
      parentId: ref.parentId,
      rowId: ref.rowId,
      uid,
      memberName,
      phone,
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      pkgId: row.pkgId?.toString(),
      method: row.method,
      time: readTime(ref.source, row),
      status: readStatus(ref.source, row),
    };
  }
}
