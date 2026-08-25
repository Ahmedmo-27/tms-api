import { Types } from "mongoose";
import { Server } from "http";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import ScheduledClass from "../models/scheduledClass";
import Class from "../models/class";
import DailyAttendance from "../models/dailyAttendance";
import NonUserBooking from "../models/nonUserBookings";
import Package from "../models/package";
import Coach from "../models/coach";
import User from "../models/user";
import Member from "../models/member";
import Payment from "../models/payment";
import Refund from "../models/refund";
import { BookingsService } from "./bookings-service";
import { SubscriptionsService } from "./subscriptions-service";
import { SchedulerService } from "./scheduler-service";
import {
  CAIRO_TZ,
  cairoDateKey,
  cairoDayRange,
  startOfDateCairo,
} from "../utils/timezone";
import {
  attendanceEntryMatchesLocation,
  locationIdScalarQuery,
  locationIdsArrayQuery,
} from "../utils/location-scope";
import {
  matchSpaceRowForPayment,
  spacePaymentPurpose,
} from "../utils/sheet-space-payments";
import {
  formatSheetClassHeader,
  parseSheetClassHeader,
  matchCatalogClassForHeader,
  scoreCatalogClassTitle,
  normalizeSheetHeader,
} from "../utils/sheet-import";
import { ApiError, BadRequestError, ConflictError } from "../core/ApiError";
import { staffSheetErrorFromApi } from "../utils/error-messages";
import {
  BOOKING_ERROR_MESSAGES,
  bookingPackageErrorMessage,
  type BookingPackageFailureCode,
} from "../utils/booking-package-errors";
import {
  selectEligiblePackage,
  type EligibilityPackage,
} from "../utils/package-eligibility";
import { normalizePhoneNumber } from "../utils/phone";
import { runInTransaction } from "../utils/transaction";
import {
  CLASS_MEMBER_LABELS,
  CLASS_PURPOSE_LABELS,
  SPACE_MEMBER_LABELS,
  SPACE_PURPOSE_LABELS,
  classifySheetRow,
  displayPaymentMethod,
  mapClassMethodToSheetLabel,
  mapOpenGymMethodToSheetLabel,
  mapPaymentMethod,
  mapPtMethodToSheetLabel,
  matchPackageByPurpose,
  type SheetPackageCandidate,
  type SheetPane,
} from "../utils/sheet-labels";

export type SheetRowStatus = "in_app" | "draft" | "saved" | "error" | "skipped";

export interface SheetPersonRow {
  id: string;
  source: "class_scan" | "non_user" | "pt" | "open_gym" | "payment";
  memberId?: string;
  name: string;
  memberLabel: string;
  amount?: number | null;
  paymentMethod?: string;
  purpose?: string;
  phone?: string;
  note?: string;
  paymentId?: string;
  scid?: string;
}

export interface SheetClassBlock {
  scid: string;
  title: string;
  coachName: string;
  startTime: string;
  classPrice?: number | null;
  rows: SheetPersonRow[];
}

export interface SheetDayResponse {
  date: string;
  locationId: string | null;
  classes: SheetClassBlock[];
  spacePt: SheetPersonRow[];
  memberLabels: { class: string[]; spacePt: string[] };
  purposeLabels: { class: string[]; spacePt: string[] };
  paymentMethods: string[];
}

export interface SheetCommitRow {
  clientRowId: string;
  pane: SheetPane;
  scid?: string;
  memberId?: string;
  name: string;
  memberLabel?: string;
  amount?: number | null;
  paymentMethod?: string;
  purpose?: string;
  phone?: string;
  note?: string;
  amountText?: string;
}

export interface SheetCommitResult {
  clientRowId: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  code?: string;
}

export interface SheetImportPerson {
  name: string;
  memberLabel?: string;
  amount?: number | null;
  paymentMethod?: string;
  purpose?: string;
  phone?: string;
  note?: string;
  amountText?: string;
}

export interface SheetImportClass {
  title: string;
  coachName?: string;
  rows: SheetImportPerson[];
}

export interface SheetImportSummary {
  ok: number;
  skipped: number;
  failed: number;
  classesMatched: number;
  classesCreated: number;
}

export interface SheetImportResponse {
  results: SheetCommitResult[];
  summary: SheetImportSummary;
}

export interface SheetMemberEligibility {
  ok: boolean;
  memberLabel?: string;
  purpose?: string;
  packageName?: string;
  remainingClasses?: number;
  error?: string;
  code?: string;
}

type LooseDoc = Record<string, any>;

function asId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === "object" && value && "_id" in (value as LooseDoc)) {
    return String((value as LooseDoc)._id);
  }
  return undefined;
}

function asName(value: unknown, fallback = ""): string {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "name" in (value as LooseDoc)) {
    return String((value as LooseDoc).name || fallback);
  }
  return fallback;
}

export function formatSheetPhone(raw?: unknown): string {
  if (raw == null) return "";
  let s = "";
  if (typeof raw === "string") s = raw;
  else if (typeof raw === "object" && raw && "phoneNumber" in (raw as LooseDoc)) {
    s = String((raw as LooseDoc).phoneNumber || "");
  }
  s = s.trim().replace(/^="|^"|"$/g, "").replace(/\.0+$/, "");
  const digits = s.replace(/\D/g, "");
  if (!digits) return s;
  if (digits.length === 10 && digits.startsWith("1")) {
    return `0${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("201")) {
    return `0${digits.slice(2)}`;
  }
  if (digits.length === 11 && digits.startsWith("01")) {
    return digits;
  }
  if (digits.length === 8 || digits.length === 9) {
    return digits.startsWith("0") ? digits : `0${digits}`;
  }
  return digits || s;
}

function asPhone(value: unknown): string {
  return formatSheetPhone(value);
}

function normalizeNameKey(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cairoHoursMinutes(date: Date): { hours: number; minutes: number } {
  const cairo = toZonedTime(date, CAIRO_TZ);
  return { hours: cairo.getHours(), minutes: cairo.getMinutes() };
}

function classSessionTimes(dateKey: string, hours: number, minutes: number) {
  const cairo = toZonedTime(startOfDateCairo(dateKey), CAIRO_TZ);
  cairo.setHours(hours, minutes, 0, 0);
  const start = fromZonedTime(cairo, CAIRO_TZ);
  const endCairo = new Date(cairo);
  endCairo.setMinutes(endCairo.getMinutes() + 60);
  const end = fromZonedTime(endCairo, CAIRO_TZ);
  return { start, end };
}

function coachNames(coachId: unknown): string {
  if (!coachId) return "";
  const list = Array.isArray(coachId) ? coachId : [coachId];
  return list
    .map((c) => {
      if (!c) return "";
      if (typeof c === "string") return c;
      return (c as LooseDoc).coachName || (c as LooseDoc).name || "";
    })
    .filter(Boolean)
    .join(" & ");
}

function noopIo(): Server {
  return { emit: () => undefined } as unknown as Server;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return err.code;
  return undefined;
}

function sheetRowFailure(err: unknown): { error: string; code?: string } {
  if (err instanceof ApiError) {
    const mapped = staffSheetErrorFromApi(err);
    return { error: mapped.message, code: mapped.code };
  }
  if (err instanceof Error) return { error: err.message };
  return { error: "Unexpected error", code: "UNEXPECTED_ERROR" };
}

function isAlreadyRecorded(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const code = err.code || "";
  const message = errorMessage(err).toLowerCase();
  return (
    code === "ATTENDANCE_ALREADY_RECORDED" ||
    code === "ATTENDANCE_RECORDED" ||
    message.includes("already recorded") ||
    message.includes("already booked") ||
    message.includes("already attended")
  );
}

function sheetPaymentNote(row: SheetCommitRow, fallback?: string): string | undefined {
  const note = (row.note || "").trim();
  const extra = (fallback || "").trim();
  if (note && extra && note !== extra) return `${extra}; ${note}`;
  return note || extra || undefined;
}

function paymentPerson(p: LooseDoc): {
  memberId?: string;
  name: string;
  phone: string;
} {
  const uid = p.uid as unknown;
  return {
    memberId: asId(uid),
    name: asName(uid, p.nonMemberName || ""),
    phone: asPhone(uid) || asPhone(p.nonMemberPhone) || "",
  };
}

function entryOnCairoDay(
  entry: LooseDoc,
  dayStart: Date,
  dayEnd: Date,
): boolean {
  if (!entry.time) return false;
  const time = new Date(entry.time);
  return time >= dayStart && time < dayEnd;
}

export class SheetService {
  static async getDay(
    date: string,
    locationId: string | null,
  ): Promise<SheetDayResponse> {
    const dateKey = cairoDateKey(date);
    const dayStart = startOfDateCairo(dateKey);
    const dayEnd = cairoDayRange(dateKey).end;

    const classQuery: Record<string, unknown> = {
      startTime: { $gte: dayStart, $lt: dayEnd },
    };
    if (locationId) {
      Object.assign(classQuery, locationIdScalarQuery(locationId));
    }

    const attendanceStart = new Date(dayStart.getTime() - 36 * 60 * 60 * 1000);
    const attendanceEnd = new Date(dayEnd.getTime() + 36 * 60 * 60 * 1000);
    const paymentQuery: Record<string, unknown> = {
      paymentTime: { $gte: dayStart, $lt: dayEnd },
      amount: { $gt: 0 },
      isRefunded: { $ne: true },
    };
    const refundQuery: Record<string, unknown> = {
      createdAt: { $gte: dayStart, $lt: dayEnd },
    };
    if (locationId) {
      Object.assign(paymentQuery, locationIdScalarQuery(locationId));
      Object.assign(refundQuery, locationIdScalarQuery(locationId));
    }

    const [scheduledClasses, attendanceDocs, payments, refunds, packages, coaches] =
      await Promise.all([
        ScheduledClass.find(classQuery)
          .populate({ path: "scans.uid", select: "name phoneNumber" })
          .populate({ path: "cid", select: "title price" })
          .populate({ path: "coachId", select: "coachName" })
          .sort({ startTime: 1 })
          .lean(),
        DailyAttendance.find({
          date: { $gte: attendanceStart, $lt: attendanceEnd },
        })
          .populate({ path: "ptAttendance.uid", select: "name phoneNumber" })
          .populate({
            path: "openGymAttendance.uid",
            select: "name phoneNumber",
          })
          .lean(),
        Payment.find(paymentQuery)
          .populate({ path: "uid", select: "name phoneNumber" })
          .populate({ path: "pkgId", select: "name" })
          .lean(),
        Refund.find(refundQuery)
          .populate({ path: "memberId", select: "name phoneNumber" })
          .lean(),
        Package.find({ hidden: { $ne: true } })
          .populate({ path: "coachId", select: "coachName" })
          .select("name category numberOfSessions locationId coachId")
          .lean(),
        Coach.find({}).select("coachName").lean(),
      ]);

    const scids = scheduledClasses.map((cls) => String(cls._id));
    const [nonUserBookings, classPayments] = scids.length
      ? await Promise.all([
          NonUserBooking.find({
            scid: { $in: scids },
            status: { $ne: "CANCELLED" },
          })
            .populate("paymentId")
            .lean(),
          Payment.find({
            scid: { $in: scids },
            amount: { $gt: 0 },
            isRefunded: { $ne: true },
          })
            .populate({ path: "uid", select: "name phoneNumber" })
            .populate({ path: "pkgId", select: "name" })
            .lean(),
        ])
      : [[], []];

    const usedPaymentIds = new Set<string>();
    const paymentByScid = new Map<string, LooseDoc[]>();
    const seenPaymentIds = new Set<string>();
    for (const payment of [...(payments as LooseDoc[]), ...(classPayments as LooseDoc[])]) {
      if (Number(payment.amount) <= 0) continue;
      const id = asId(payment._id);
      if (id) {
        if (seenPaymentIds.has(id)) continue;
        seenPaymentIds.add(id);
      }
      const scid = asId(payment.scid);
      if (!scid) continue;
      const list = paymentByScid.get(scid) ?? [];
      list.push(payment);
      paymentByScid.set(scid, list);
    }

    const takePayment = (
      scid: string | undefined,
      memberId?: string,
      name?: string,
    ): LooseDoc | undefined => {
      if (!scid) return undefined;
      const list = paymentByScid.get(scid) ?? [];
      const nameKey = name ? normalizeNameKey(name) : "";
      const match = list.find((p) => {
        const id = asId(p._id);
        if (id && usedPaymentIds.has(id)) return false;
        const person = paymentPerson(p);
        if (memberId && person.memberId === memberId) return true;
        if (nameKey && normalizeNameKey(person.name) === nameKey) return true;
        return false;
      });
      const id = asId(match?._id);
      if (id) usedPaymentIds.add(id);
      return match;
    };

    const classes: SheetClassBlock[] = scheduledClasses.map((cls) => {
      const scid = String(cls._id);
      const title =
        (cls as LooseDoc).className || (cls.cid as LooseDoc)?.title || "Class";
      const startTime = new Date(cls.startTime);
      const rows: SheetPersonRow[] = [];

      for (let scanIndex = 0; scanIndex < (cls.scans || []).length; scanIndex++) {
        const scan = cls.scans[scanIndex];
        if (scan.status !== true) continue;
        const memberId = asId(scan.uid);
        const name = asName(scan.uid, "Unknown Member");
        const mapped = mapClassMethodToSheetLabel(scan.method || "");
        const payment = takePayment(scid, memberId, name);
        const isDropIn = mapped.kind === "dropin";
        const scanKey =
          asId((scan as LooseDoc)._id) ||
          String((scan as LooseDoc).scanTime || scanIndex);
        rows.push({
          id: `scan:${scid}:${memberId || name}:${scanKey}`,
          source: "class_scan",
          memberId,
          name,
          memberLabel: isDropIn ? "" : mapped.label,
          amount: payment
            ? Number(payment.amount)
            : isDropIn
              ? ((cls.cid as LooseDoc)?.price ?? null)
              : null,
          paymentMethod: displayPaymentMethod(payment?.paymentMethod) || "",
          purpose: payment
            ? (payment.pkgId as LooseDoc)?.name || (isDropIn ? "Drop in" : "")
            : isDropIn
              ? "Drop in"
              : (scan.method || "").trim(),
          phone: asPhone(scan.uid),
          paymentId: asId(payment?._id),
          scid,
          note: payment?.note || "",
        });
      }

      for (const booking of nonUserBookings.filter(
        (b) => asId(b.scid) === scid,
      )) {
        const paymentDoc = booking.paymentId as LooseDoc | undefined;
        const paymentId = asId(paymentDoc);
        if (paymentId) usedPaymentIds.add(paymentId);
        const amount =
          paymentDoc?.amount != null ? Number(paymentDoc.amount) : null;
        rows.push({
          id: `guest:${String(booking._id)}`,
          source: "non_user",
          name: booking.name,
          memberLabel: amount ? "" : "FOC",
          amount,
          paymentMethod: displayPaymentMethod(paymentDoc?.paymentMethod),
          purpose: amount ? "Drop in" : "",
          phone: booking.phoneNumber || "",
          paymentId,
          scid,
          note: paymentDoc?.note || "",
        });
      }

      return {
        scid,
        title: formatSheetClassHeader(title, startTime),
        coachName: coachNames(cls.coachId),
        startTime: startTime.toISOString(),
        classPrice: (cls.cid as LooseDoc)?.price ?? null,
        rows,
      };
    });

    const spacePt: SheetPersonRow[] = [];
    const attendance = attendanceDocs;
    const ptEntries = locationId
      ? attendance.flatMap((doc) =>
          (doc.ptAttendance || []).filter((entry: LooseDoc) => {
            if (entry.status && entry.status !== "SUCCESS" && entry.status !== true) {
              return false;
            }
            if (!entryOnCairoDay(entry, dayStart, dayEnd)) return false;
            return attendanceEntryMatchesLocation(entry, locationId);
          }),
        )
      : [];
    const ogEntries = locationId
      ? attendance.flatMap((doc) =>
          (doc.openGymAttendance || []).filter((entry: LooseDoc) => {
            if (entry.status && entry.status !== "SUCCESS" && entry.status !== true) {
              return false;
            }
            if (!entryOnCairoDay(entry, dayStart, dayEnd)) return false;
            return attendanceEntryMatchesLocation(entry, locationId);
          }),
        )
      : [];

    for (let i = 0; i < ptEntries.length; i++) {
      const scan = ptEntries[i] as LooseDoc;
      const memberId = asId(scan.uid);
      const mapped = mapPtMethodToSheetLabel(scan.method || "");
      spacePt.push({
        id: `pt:${memberId || asName(scan.uid)}:${scan.time || i}:${asId(scan._id) || i}`,
        source: "pt",
        memberId,
        name: asName(scan.uid, "Unknown Member"),
        memberLabel: mapped.kind === "dropin" ? "" : mapped.label,
        amount: null,
        paymentMethod: "",
        purpose:
          mapped.kind === "dropin" ? "Drop in" : (scan.method || "").trim(),
        phone: asPhone(scan.uid),
      });
    }

    for (let i = 0; i < ogEntries.length; i++) {
      const scan = ogEntries[i] as LooseDoc;
      const memberId = asId(scan.uid);
      const mapped = mapOpenGymMethodToSheetLabel(scan.method || "");
      const isDropIn = mapped.kind === "dropin";
      spacePt.push({
        id: `og:${memberId || scan.guestName || ""}:${scan.time || i}:${asId(scan._id) || i}`,
        source: "open_gym",
        memberId,
        name: asName(scan.uid, scan.guestName || "Unknown Member"),
        memberLabel: isDropIn ? "" : mapped.label,
        amount: null,
        paymentMethod: "",
        purpose: isDropIn ? "Drop in Space" : (scan.method || "").trim(),
        phone: asPhone(scan.uid) || scan.guestPhone || "",
      });
    }

    if (locationId) {
      const allPayments = [
        ...(payments as LooseDoc[]),
        ...(classPayments as LooseDoc[]),
      ];
      const spacePtUsedPaymentIds = new Set<string>();
      for (const payment of allPayments) {
        const id = asId(payment._id);
        if (!id || spacePtUsedPaymentIds.has(id)) continue;
        if (Number(payment.amount) <= 0) continue;
        const person = paymentPerson(payment);
        const existing = matchSpaceRowForPayment(spacePt, {
          memberId: person.memberId,
          name: person.name,
          phone: person.phone,
        });
        if (existing) {
          existing.amount = Number(payment.amount);
          existing.paymentMethod = displayPaymentMethod(payment.paymentMethod);
          existing.purpose = spacePaymentPurpose(payment, existing.purpose);
          existing.paymentId = id;
          existing.note = payment.note || existing.note || "";
          if (!existing.phone && person.phone) existing.phone = person.phone;
          spacePtUsedPaymentIds.add(id);
          continue;
        }
        spacePt.push({
          id: `pay:${id}`,
          source: "payment",
          memberId: person.memberId,
          name: person.name || "Unknown",
          memberLabel: "",
          amount: Number(payment.amount),
          paymentMethod: displayPaymentMethod(payment.paymentMethod),
          purpose: spacePaymentPurpose(payment),
          phone: person.phone,
          paymentId: id,
          note: payment.note || "",
        });
        spacePtUsedPaymentIds.add(id);
      }

      for (const refund of (refunds as LooseDoc[])) {
        const refundId = asId(refund._id);
        if (!refundId) continue;
        const isCashOut = refund.type === "CASHOUT";
        const member = refund.memberId as LooseDoc | undefined;
        const memberId = asId(member) || (typeof refund.memberId === "string" ? refund.memberId : undefined);
        const name = isCashOut
          ? "Cash Out"
          : (asName(member) || refund.memberName || "Refund");
        const phone = asPhone(member);
        const reasonText = (refund.reason || "").trim();
        const purpose = isCashOut
          ? (reasonText || "Cash Out")
          : (reasonText ? (reasonText.toLowerCase().startsWith("refund") ? reasonText : `Refund: ${reasonText}`) : "Refund");

        spacePt.push({
          id: `refund:${refundId}`,
          source: "payment",
          memberId: isCashOut ? undefined : memberId,
          name,
          memberLabel: "",
          amount: -Math.abs(Number(refund.amount) || 0),
          paymentMethod: "Cash",
          purpose,
          phone: isCashOut ? "" : phone,
          note: refund.reason || "",
        });
      }
    }

    const locationPackages = (packages as LooseDoc[]).filter((pkg) => {
      const pkgLoc = asId(pkg.locationId);
      return !pkgLoc || !locationId || pkgLoc === locationId;
    });
    const packageNames = locationPackages.map((pkg) => pkg.name).filter(Boolean);
    const ptCoachLabels = (coaches as LooseDoc[])
      .map((c) => c.coachName)
      .filter(Boolean)
      .map((name: string) => `PT with ${name}`);

    return {
      date: dateKey,
      locationId,
      classes,
      spacePt,
      memberLabels: {
        class: CLASS_MEMBER_LABELS,
        spacePt: [...SPACE_MEMBER_LABELS, ...ptCoachLabels],
      },
      purposeLabels: {
        class: [...CLASS_PURPOSE_LABELS, ...packageNames],
        spacePt: [...SPACE_PURPOSE_LABELS, ...packageNames],
      },
      paymentMethods: ["Cash", "Visa", "App", "Instapay", "Valu", "Payment Link"],
    };
  }

  static async commitRows(opts: {
    date: string;
    locationId: string;
    rows: SheetCommitRow[];
    io?: Server;
  }): Promise<SheetCommitResult[]> {
    const io = opts.io ?? noopIo();
    const dateKey = cairoDateKey(opts.date);
    const catalog = await this.loadPackageCatalog(opts.locationId);
    const results: SheetCommitResult[] = [];

    for (const row of opts.rows) {
      results.push(
        await this.commitOne(row, dateKey, opts.locationId, catalog, io),
      );
    }
    return results;
  }

  /**
   * Preview of the package a check-in would spend, so the sheet can fill the
   * Member and Purpose columns the moment a member is picked instead of
   * failing at save time.
   */
  static async getMemberEligibility(opts: {
    memberId: string;
    pane: SheetPane;
    scid?: string;
  }): Promise<SheetMemberEligibility> {
    if (!Types.ObjectId.isValid(opts.memberId)) {
      return {
        ok: false,
        error: "Pick the member from search",
        code: "MEMBER_REQUIRED",
      };
    }
    const user = await User.findById(opts.memberId).select("_id");
    if (!user) {
      return { ok: false, error: "Member not found", code: "MEMBER_NOT_FOUND" };
    }

    const member = (await Member.findOne({ uid: user._id })
      .populate({ path: "packages.pkgId", select: "name" })
      .lean()) as LooseDoc | null;
    if (!member) {
      return { ok: false, error: "Member not found", code: "MEMBER_NOT_FOUND" };
    }

    const packages: EligibilityPackage[] = (member.packages || []).map(
      (pkg: LooseDoc) => ({
        pkgId: asId(pkg.pkgId) || "",
        name: (pkg.pkgId as LooseDoc)?.name || pkg.name || "",
        status: pkg.status,
        pkgStartDate: pkg.pkgStartDate,
        pkgEndDate: pkg.pkgEndDate,
        remainingClasses: Number(pkg.remainingClasses ?? 0),
        classRestrictionsRecord: pkg.classRestrictionsRecord,
      }),
    );

    return opts.pane === "class"
      ? this.classEligibility(packages, opts.scid)
      : this.spacePtEligibility(packages);
  }

  private static async classEligibility(
    packages: EligibilityPackage[],
    scid?: string,
  ): Promise<SheetMemberEligibility> {
    if (!scid || !Types.ObjectId.isValid(scid)) {
      return { ok: false, error: "Class not found", code: "CLASS_NOT_FOUND" };
    }
    const scheduled = (await ScheduledClass.findById(scid)
      .populate({ path: "cid", select: "title locations" })
      .populate({ path: "locationId", select: "branchName" })
      .lean()) as LooseDoc | null;
    if (!scheduled?.cid) {
      return { ok: false, error: "Class not found", code: "CLASS_NOT_FOUND" };
    }

    const catalogClass = scheduled.cid as LooseDoc;
    const className = catalogClass.title as string | undefined;
    const branchName =
      (scheduled.locationId as LooseDoc)?.branchName ||
      (catalogClass.locations || [])[0]?.branchName ||
      "";

    const allowed = await Package.getClassPackages(
      String(catalogClass._id),
      branchName,
    );
    if (!allowed.length) {
      return {
        ok: false,
        error: BOOKING_ERROR_MESSAGES.NO_CLASS_PACKAGES_CONFIGURED(className),
        code: "NO_CLASS_PACKAGES_CONFIGURED",
      };
    }

    const start = new Date(scheduled.startTime);
    const month = `${start.getMonth() + 1}${start.getFullYear()}`;
    const selected = selectEligiblePackage({
      packages,
      allowedPkgIds: allowed,
      cid: String(catalogClass._id),
      month,
    });

    if (!selected.ok) {
      return {
        ok: false,
        error: bookingPackageErrorMessage(selected.code, className),
        code: selected.code,
      };
    }

    const mapped = mapClassMethodToSheetLabel(selected.pkg.name);
    return {
      ok: true,
      memberLabel: mapped.kind === "dropin" ? "" : mapped.label,
      purpose: selected.pkg.name,
      packageName: selected.pkg.name,
      remainingClasses: Number(selected.pkg.remainingClasses),
    };
  }

  private static async spacePtEligibility(
    packages: EligibilityPackage[],
  ): Promise<SheetMemberEligibility> {
    const spaceIds = await Package.getSpaceWalkPackageIds();
    const space = selectEligiblePackage({ packages, allowedPkgIds: spaceIds });
    if (space.ok) {
      const mapped = mapOpenGymMethodToSheetLabel(space.pkg.name);
      return {
        ok: true,
        memberLabel: mapped.kind === "dropin" ? "" : mapped.label,
        purpose: space.pkg.name,
        packageName: space.pkg.name,
        remainingClasses: Number(space.pkg.remainingClasses),
      };
    }

    const ptPackages = await Package.find({
      category: "PERSONAL_TRAINING",
    }).select("_id");
    const pt = selectEligiblePackage({
      packages,
      allowedPkgIds: ptPackages.map((pkg) => String(pkg._id)),
    });
    if (pt.ok) {
      const mapped = mapPtMethodToSheetLabel(pt.pkg.name);
      return {
        ok: true,
        memberLabel: mapped.kind === "dropin" ? "" : mapped.label,
        purpose: pt.pkg.name,
        packageName: pt.pkg.name,
        remainingClasses: Number(pt.pkg.remainingClasses),
      };
    }

    return {
      ok: false,
      error: this.spacePtEligibilityError(space.code, pt.code),
      code: space.code === "NO_ACTIVE_PACKAGE_FOUND" ? space.code : pt.code,
    };
  }

  private static spacePtEligibilityError(
    spaceCode: BookingPackageFailureCode,
    ptCode: BookingPackageFailureCode,
  ): string {
    if (
      spaceCode === "NO_ACTIVE_PACKAGE_FOUND" &&
      ptCode === "NO_ACTIVE_PACKAGE_FOUND"
    ) {
      return BOOKING_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND(undefined, "admin");
    }
    if (spaceCode === "PACKAGE_EXPIRED" || ptCode === "PACKAGE_EXPIRED") {
      return "The Space or PT package for this member has expired.";
    }
    if (
      spaceCode === "NO_REMAINING_SESSIONS" ||
      ptCode === "NO_REMAINING_SESSIONS"
    ) {
      return "The Space or PT package for this member has no remaining sessions.";
    }
    return "This member has no active Space or PT package.";
  }

  static async importDay(opts: {
    date: string;
    locationId: string;
    classes: SheetImportClass[];
    spacePt: SheetImportPerson[];
    io?: Server;
  }): Promise<SheetImportResponse> {
    const io = opts.io ?? noopIo();
    const dateKey = cairoDateKey(opts.date);
    const locationId = opts.locationId;
    const dayStart = startOfDateCairo(dateKey);
    const dayEnd = cairoDayRange(dateKey).end;

    const [scheduledDocs, catalogClasses] = await Promise.all([
      ScheduledClass.find({
        startTime: { $gte: dayStart, $lt: dayEnd },
        ...locationIdScalarQuery(locationId),
      })
        .populate({ path: "cid", select: "title" })
        .lean(),
      Class.find(locationIdsArrayQuery(locationId))
        .select("title category locations")
        .lean(),
    ]);
    const scheduled: LooseDoc[] = [...scheduledDocs];

    const results: SheetCommitResult[] = [];
    const toCommit: SheetCommitRow[] = [];
    let classesMatched = 0;
    let classesCreated = 0;

    for (let classIndex = 0; classIndex < (opts.classes || []).length; classIndex++) {
      const block = opts.classes[classIndex];
      const people = (block.rows || []).filter((row) => (row.name || "").trim());
      if (people.length === 0) continue;

      const resolved = await this.resolveImportClass(
        block,
        dateKey,
        locationId,
        scheduled,
        catalogClasses as Array<{ _id: unknown; title: string; category?: string }>,
      );

      if (!resolved.ok) {
        for (let rowIndex = 0; rowIndex < people.length; rowIndex++) {
          results.push({
            clientRowId: `import:class:${classIndex}:${rowIndex}`,
            ok: false,
            error: resolved.error,
            code: resolved.code,
          });
        }
        continue;
      }

      if (resolved.created) classesCreated += 1;
      else classesMatched += 1;

      if (resolved.created) {
        scheduled.push({
          _id: resolved.scid,
          className: parseSheetClassHeader(block.title)?.name || block.title,
          startTime: resolved.startTime,
          cid: { title: parseSheetClassHeader(block.title)?.name || block.title },
        } as LooseDoc);
      }

      for (let rowIndex = 0; rowIndex < people.length; rowIndex++) {
        const person = people[rowIndex];
        toCommit.push({
          clientRowId: `import:class:${classIndex}:${rowIndex}`,
          pane: "class",
          scid: resolved.scid,
          name: person.name.trim(),
          memberLabel: person.memberLabel,
          amount: person.amount,
          paymentMethod: person.paymentMethod,
          purpose: person.purpose,
          phone: person.phone,
          note: person.note,
          amountText: person.amountText,
        });
      }
    }

    for (let rowIndex = 0; rowIndex < (opts.spacePt || []).length; rowIndex++) {
      const person = opts.spacePt[rowIndex];
      if (!(person.name || "").trim()) continue;
      toCommit.push({
        clientRowId: `import:space:${rowIndex}`,
        pane: "space_pt",
        name: person.name.trim(),
        memberLabel: person.memberLabel,
        amount: person.amount,
        paymentMethod: person.paymentMethod,
        purpose: person.purpose,
        phone: person.phone,
        note: person.note,
        amountText: person.amountText,
      });
    }

    if (toCommit.length > 0) {
      results.push(
        ...(await this.commitRows({
          date: dateKey,
          locationId,
          rows: toCommit,
          io,
        })),
      );
    }

    return {
      results,
      summary: {
        ok: results.filter((r) => r.ok && !r.skipped).length,
        skipped: results.filter((r) => r.ok && r.skipped).length,
        failed: results.filter((r) => !r.ok).length,
        classesMatched,
        classesCreated,
      },
    };
  }

  private static matchCatalogClass<T extends { title: string; category?: string }>(
    headerName: string,
    headerLabel: string,
    catalogClasses: T[],
  ):
    | { ok: true; catalog: T }
    | { ok: false; error: string; code: string } {
    const matched = matchCatalogClassForHeader(headerName, catalogClasses);
    if (matched.ok) return { ok: true, catalog: matched.item };

    if (matched.reason === "category_missing") {
      const label = matched.category
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      return {
        ok: false,
        error: `"${headerLabel}" is ${label}, but this branch has no ${label} class in the catalog. Add the class to this branch, then import again.`,
        code: "CATALOG_CATEGORY_MISSING",
      };
    }

    if (matched.reason === "ambiguous") {
      const titles = matched.titles;
      const shown = titles.slice(0, 3).join(", ");
      const suffix = titles.length > 3 ? ", …" : "";
      return {
        ok: false,
        error: `"${headerName}" matches ${titles.length} classes at this branch (${shown}${suffix}). Use the full class name.`,
        code: "CATALOG_CLASS_AMBIGUOUS",
      };
    }

    return {
      ok: false,
      error: `No catalog class matches "${headerLabel}" at this branch`,
      code: "CATALOG_CLASS_NOT_FOUND",
    };
  }

  private static async resolveImportClass(
    block: SheetImportClass,
    dateKey: string,
    locationId: string,
    scheduled: LooseDoc[],
    catalogClasses: Array<{ _id: unknown; title: string; category?: string }>,
  ): Promise<
    | { ok: true; scid: string; created: boolean; startTime: Date }
    | { ok: false; error: string; code: string }
  > {
    const parsed = parseSheetClassHeader(block.title);
    const matchedExisting = this.matchScheduledClass(block.title, parsed, scheduled);
    if (matchedExisting) {
      return {
        ok: true,
        scid: String(matchedExisting._id),
        created: false,
        startTime: new Date(matchedExisting.startTime),
      };
    }

    if (!parsed) {
      return {
        ok: false,
        error: `Could not read a class time from "${block.title}"`,
        code: "CLASS_TIME_UNREADABLE",
      };
    }

    const matched = this.matchCatalogClass(
      parsed.name,
      block.title,
      catalogClasses,
    );
    if (!matched.ok) return matched;
    const catalog = matched.catalog;

    const { start, end } = classSessionTimes(dateKey, parsed.hours, parsed.minutes);
    const coachIds = await this.findCoachIds(block.coachName || "");

    try {
      const created = await SchedulerService.scheduleClass(
        String(catalog._id),
        start.toISOString(),
        end.toISOString(),
        "25",
        coachIds,
        locationId,
      );
      return {
        ok: true,
        scid: String(created._id),
        created: true,
        startTime: start,
      };
    } catch (err) {
      if (err instanceof ConflictError && err.code === "CLASS_ALREADY_SCHEDULED") {
        const existing = await ScheduledClass.findOne({
          cid: catalog._id,
          ...locationIdScalarQuery(locationId),
          startTime: {
            $gte: new Date(start.getTime() - 60_000),
            $lte: new Date(start.getTime() + 60_000),
          },
        }).select("_id startTime");
        if (existing) {
          return {
            ok: true,
            scid: String(existing._id),
            created: false,
            startTime: existing.startTime,
          };
        }
      }
      return {
        ok: false,
        error: errorMessage(err),
        code: errorCode(err) || "CLASS_SCHEDULE_FAILED",
      };
    }
  }

  private static matchScheduledClass(
    csvTitle: string,
    parsed: ReturnType<typeof parseSheetClassHeader>,
    scheduled: LooseDoc[],
  ): LooseDoc | undefined {
    const wanted = normalizeSheetHeader(csvTitle);
    for (const cls of scheduled) {
      const title = cls.className || (cls.cid as LooseDoc)?.title || "Class";
      const startTime = new Date(cls.startTime);
      if (normalizeSheetHeader(formatSheetClassHeader(title, startTime)) === wanted) {
        return cls;
      }
    }

    if (!parsed) return undefined;

    let best: { cls: LooseDoc; score: number } | undefined;
    for (const cls of scheduled) {
      const title = cls.className || (cls.cid as LooseDoc)?.title || "";
      const startTime = new Date(cls.startTime);
      const clock = cairoHoursMinutes(startTime);
      if (clock.hours !== parsed.hours || clock.minutes !== parsed.minutes) {
        continue;
      }
      const score = Math.max(
        scoreCatalogClassTitle(parsed.name, title),
        scoreCatalogClassTitle(
          csvTitle,
          formatSheetClassHeader(title, startTime),
        ),
      );
      if (score < 70) continue;
      if (!best || score > best.score) best = { cls, score };
    }
    return best?.cls;
  }

  private static async findCoachIds(coachName: string): Promise<string[]> {
    const name = coachName.trim();
    if (!name) return [];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exact = await Coach.findOne({
      coachName: { $regex: new RegExp(`^${escaped}$`, "i") },
    }).select("_id");
    if (exact) return [String(exact._id)];

    const partial = await Coach.findOne({
      coachName: { $regex: new RegExp(escaped, "i") },
    }).select("_id");
    if (partial) return [String(partial._id)];

    const first = name.split(/\s+/)[0];
    const firstEscaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = await Coach.find({
      coachName: { $regex: new RegExp(`^${firstEscaped}\\b`, "i") },
    })
      .select("_id")
      .limit(2);
    if (matches.length === 1) return [String(matches[0]._id)];
    return [];
  }

  private static async loadPackageCatalog(
    locationId: string,
  ): Promise<SheetPackageCandidate[]> {
    const packages = await Package.find({ hidden: { $ne: true } })
      .populate({ path: "coachId", select: "coachName" })
      .select("name category numberOfSessions locationId coachId")
      .lean();
    return (packages as LooseDoc[])
      .filter((pkg) => {
        const pkgLoc = asId(pkg.locationId);
        return !pkgLoc || pkgLoc === locationId;
      })
      .map((pkg) => ({
        id: String(pkg._id),
        name: pkg.name,
        category: pkg.category,
        numberOfSessions: pkg.numberOfSessions,
        coachName: pkg.coachId?.coachName,
      }));
  }

  private static async commitOne(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
    catalog: SheetPackageCandidate[],
    io: Server,
  ): Promise<SheetCommitResult> {
    try {
      const intent = classifySheetRow({
        pane: row.pane,
        name: row.name,
        memberLabel: row.memberLabel,
        purpose: row.purpose,
        amount: row.amount,
        paymentMethod: row.paymentMethod,
        amountText: row.amountText,
      });

      if (intent.kind === "invalid") {
        return {
          clientRowId: row.clientRowId,
          ok: false,
          error: intent.reason,
          code: "INVALID_ROW",
        };
      }
      if (intent.kind === "skip_unmapped") {
        return {
          clientRowId: row.clientRowId,
          ok: true,
          skipped: true,
          error: intent.reason,
          code: "UNMAPPED_MEMBERSHIP",
        };
      }

      if (row.pane === "class" && !row.scid) {
        return {
          clientRowId: row.clientRowId,
          ok: false,
          error: "This class row is missing its session",
          code: "SESSION_MISSING",
        };
      }
      if (row.scid) {
        await SchedulerService.assertSessionAtLocation(row.scid, locationId);
      }

      switch (intent.kind) {
        case "class_attend":
          await this.commitClassAttend(row, io);
          break;
        case "class_dropin":
          await this.commitClassDropIn(row, dateKey, locationId, io);
          break;
        case "class_foc":
          await this.commitClassFoc(row);
          break;
        case "class_package_then_attend":
          await this.commitPackageSale(row, dateKey, locationId, catalog, io);
          if (row.scid) await this.commitClassAttend(row, io);
          break;
        case "space_attend":
          await this.commitSpaceAttend(row, locationId, io);
          break;
        case "pt_attend":
          await this.commitPtAttend(row, locationId, io);
          break;
        case "space_dropin":
          await this.commitSpaceDropIn(row, dateKey, locationId, io);
          break;
        case "package_sale":
          await this.commitPackageSale(row, dateKey, locationId, catalog, io);
          await this.followUpAttendAfterPackage(row, locationId, catalog, io);
          break;
        case "cash_out":
          await this.commitCashOut(row, dateKey, locationId);
          break;
        case "member_refund":
          await this.commitMemberRefund(row, dateKey, locationId);
          break;
        default:
          return {
            clientRowId: row.clientRowId,
            ok: false,
            error: "This row could not be classified",
            code: "UNCLASSIFIED_ROW",
          };
      }

      return { clientRowId: row.clientRowId, ok: true };
    } catch (err) {
      if (isAlreadyRecorded(err)) {
        return { clientRowId: row.clientRowId, ok: true, skipped: true };
      }
      const failure = sheetRowFailure(err);
      return {
        clientRowId: row.clientRowId,
        ok: false,
        error: failure.error,
        code: failure.code,
      };
    }
  }

  private static async resolvePerson(
    row: SheetCommitRow,
    opts: { allowGuest: boolean; requirePhoneForGuest?: boolean },
  ): Promise<
    | { kind: "member"; uid: string }
    | { kind: "guest"; name: string; phone: string }
  > {
    if (row.memberId && Types.ObjectId.isValid(row.memberId)) {
      const user = await User.findById(row.memberId).select("_id");
      if (user) return { kind: "member", uid: String(user._id) };
    }

    const phoneDigits = (row.phone || "").replace(/\D/g, "");
    if (phoneDigits.length >= 10) {
      const variants = new Set<string>([phoneDigits]);
      if (phoneDigits.length === 10) variants.add(`0${phoneDigits}`);
      if (phoneDigits.length === 11 && phoneDigits.startsWith("0")) {
        variants.add(phoneDigits.slice(1));
      }
      const user = await User.findOne({
        phoneNumber: { $in: [...variants] },
        role: "member",
      }).select("_id");
      if (user) return { kind: "member", uid: String(user._id) };
    }

    const name = row.name.trim();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let matches = await User.find({
      name: { $regex: new RegExp(`^${escaped}$`, "i") },
      role: "member",
    })
      .select("_id name")
      .limit(5);

    if (matches.length === 0) {
      const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const normalizedEscaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (normalizedEscaped !== escaped) {
        matches = await User.find({
          name: { $regex: new RegExp(`^${normalizedEscaped}$`, "i") },
          role: "member",
        })
          .select("_id name")
          .limit(5);
      }
    }

    if (matches.length === 1) {
      return { kind: "member", uid: String(matches[0]._id) };
    }
    if (matches.length > 1) {
      throw new BadRequestError(
        "AMBIGUOUS_MEMBER",
        "Pick the member from search — more than one person has this name",
      );
    }

    if (!opts.allowGuest) {
      throw new BadRequestError(
        "MEMBER_REQUIRED",
        "Pick the member — this row needs an existing member",
      );
    }
    if (opts.requirePhoneForGuest && phoneDigits.length < 10) {
      throw new BadRequestError(
        "PHONE_REQUIRED",
        "Phone number is required for this guest",
      );
    }
    return { kind: "guest", name, phone: row.phone?.trim() || "" };
  }

  private static requirePaymentMethod(row: SheetCommitRow): string {
    const mapped = mapPaymentMethod(row.paymentMethod || "");
    if (!mapped.method) {
      throw new BadRequestError(
        "PAYMENT_METHOD_REQUIRED",
        "Payment method is required for this row",
      );
    }
    return mapped.method;
  }

  private static async commitClassAttend(row: SheetCommitRow, io: Server) {
    const person = await this.resolvePerson(row, { allowGuest: false });
    if (person.kind !== "member") {
      throw new BadRequestError("MEMBER_REQUIRED", "Pick the member");
    }
    const member = await Member.findOne({ uid: person.uid });
    if (!member) {
      throw new BadRequestError("MEMBER_REQUIRED", "Pick the member");
    }
    const sc = await ScheduledClass.findById(row.scid).select("scans");
    const already = sc?.scans?.some(
      (scan) => scan.uid.toString() === person.uid && scan.status === true,
    );
    if (already) return;
    await BookingsService.manualRecordClassAttendance(person.uid, row.scid!, io);
  }

  private static async commitClassDropIn(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
    io: Server,
  ) {
    const method = this.requirePaymentMethod(row);
    const person = await this.resolvePerson(row, { allowGuest: true });
    const paymentDate = startOfDateCairo(dateKey).toISOString();
    if (person.kind === "member") {
      const sc = await ScheduledClass.findById(row.scid).select("bookedMembers");
      const existing = sc?.bookedMembers?.find(
        (b) => b.uid.toString() === person.uid,
      );
      if (existing) {
        const alreadyDropIn =
          (existing.method || "").trim().toLowerCase() === "drop in";
        if (!alreadyDropIn) {
          throw new ConflictError(
            "DROPIN_BLOCKED_BY_PACKAGE_BOOKING",
            "This member is already on this class with a package. A drop-in payment was not taken.",
          );
        }
        await this.commitClassAttend(row, io);
        return;
      }
      await BookingsService.bookAdminDropIn(
        person.uid,
        row.scid!,
        method,
        locationId,
        paymentDate,
        sheetPaymentNote(row),
      );
      try {
        await BookingsService.manualRecordClassAttendance(
          person.uid,
          row.scid!,
          io,
        );
      } catch (err) {
        if (!isAlreadyRecorded(err)) throw err;
      }
      return;
    }
    await this.walkInGuest(
      person.name,
      person.phone,
      row.scid!,
      method,
      row.amount,
      paymentDate,
      locationId,
      sheetPaymentNote(row),
    );
  }

  private static async commitClassFoc(row: SheetCommitRow) {
    const person = await this.resolvePerson(row, { allowGuest: true });
    if (person.kind === "member") {
      await BookingsService.manualRecordClassAttendance(
        person.uid,
        row.scid!,
        noopIo(),
      );
      return;
    }
    await this.walkInGuest(person.name, person.phone, row.scid!);
  }

  private static async walkInGuest(
    name: string,
    phone: string,
    scid: string,
    paymentMethod?: string,
    amount?: number | null,
    paymentDate?: string,
    locationId?: string,
    note?: string,
  ) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existing = await NonUserBooking.findOne({
      scid,
      name: { $regex: new RegExp(`^${escaped}$`, "i") },
      status: { $ne: "CANCELLED" },
    });
    if (existing) {
      if (existing.status === "BOOKED") {
        await BookingsService.recordNonUserAttendance(String(existing._id));
      }
      if (paymentMethod && !existing.paymentId) {
        await BookingsService.recordNonUserPayment(
          String(existing._id),
          paymentMethod,
          amount ?? undefined,
          paymentDate,
          undefined,
          locationId,
          note,
        );
      }
      return;
    }

    await runInTransaction(async (session) => {
      const booking = await BookingsService.addNonUserBooking(
        name,
        phone || "",
        scid,
        session,
      );
      await BookingsService.recordNonUserAttendance(
        String(booking._id),
        session,
      );
      if (paymentMethod) {
        await BookingsService.recordNonUserPayment(
          String(booking._id),
          paymentMethod,
          amount ?? undefined,
          paymentDate,
          session,
          locationId,
          note,
        );
      }
    });
  }

  private static async commitSpaceAttend(
    row: SheetCommitRow,
    locationId: string,
    io: Server,
  ) {
    const person = await this.resolvePerson(row, { allowGuest: false });
    if (person.kind !== "member") {
      throw new BadRequestError("MEMBER_REQUIRED", "Pick the member");
    }
    await BookingsService.recordOpenGymAttendance(person.uid, io, locationId);
  }

  private static async commitPtAttend(
    row: SheetCommitRow,
    locationId: string,
    io: Server,
  ) {
    const person = await this.resolvePerson(row, { allowGuest: false });
    if (person.kind !== "member") {
      throw new BadRequestError("MEMBER_REQUIRED", "Pick the member");
    }
    await BookingsService.recordPtAttendance(person.uid, io, locationId);
  }

  private static async commitSpaceDropIn(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
    io: Server,
  ) {
    const method = this.requirePaymentMethod(row);
    const person = await this.resolvePerson(row, {
      allowGuest: true,
      requirePhoneForGuest: true,
    });
    const paymentDate = startOfDateCairo(dateKey).toISOString();
    if (person.kind === "member") {
      await BookingsService.recordAdminOpenGymMemberDropIn(
        person.uid,
        method,
        io,
        locationId,
        row.amount ?? undefined,
        paymentDate,
        sheetPaymentNote(row),
      );
      return;
    }
    await BookingsService.recordAdminOpenGymGuestDropIn(
      person.name,
      normalizePhoneNumber(person.phone),
      method,
      io,
      locationId,
      row.amount ?? undefined,
      paymentDate,
      sheetPaymentNote(row),
    );
  }

  private static async commitPackageSale(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
    catalog: SheetPackageCandidate[],
    _io: Server,
  ) {
    const method = this.requirePaymentMethod(row);
    const purpose = row.purpose || row.memberLabel || "";
    const matched = matchPackageByPurpose(purpose, catalog);
    if (!matched) {
      throw new BadRequestError(
        "PACKAGE_NOT_MATCHED",
        `Could not match a catalog package for "${purpose}"`,
      );
    }
    const person = await this.resolvePerson(row, {
      allowGuest: true,
      requirePhoneForGuest: true,
    });
    const startDate = startOfDateCairo(dateKey).toISOString();
    if (person.kind === "member") {
      try {
        await SubscriptionsService.frontDeskSubscribeToPackage(
          person.uid,
          matched.id,
          startDate,
          method,
          startDate,
          row.amount ?? undefined,
          sheetPaymentNote(row, purpose),
          undefined,
          locationId,
          false,
        );
      } catch (err) {
        if (
          err instanceof ConflictError ||
          errorMessage(err).toLowerCase().includes("already")
        ) {
          return;
        }
        throw err;
      }
      return;
    }
    await SubscriptionsService.addNonUserPackage(
      person.name,
      normalizePhoneNumber(person.phone),
      matched.id,
      startDate,
      method,
      false,
      startDate,
      row.amount != null ? String(row.amount) : undefined,
      locationId,
      sheetPaymentNote(row, purpose),
    );
  }

  private static async followUpAttendAfterPackage(
    row: SheetCommitRow,
    locationId: string,
    catalog: SheetPackageCandidate[],
    io: Server,
  ) {
    const purpose = row.purpose || row.memberLabel || "";
    const matched = matchPackageByPurpose(purpose, catalog);
    if (!matched) return;
    const category = matched.category;
    try {
      if (category === "PERSONAL_TRAINING" || category === "PRE_POST_NATAL") {
        await this.commitPtAttend(row, locationId, io);
      } else if (
        category === "SPACE_MEMBERSHIP" ||
        category === "OPEN_GYM" ||
        category === "ULTIMATE_MINDSPACER" ||
        category === "MIXED"
      ) {
        await this.commitSpaceAttend(row, locationId, io);
      }
    } catch (err) {
      if (isAlreadyRecorded(err)) return;
      throw err;
    }
  }

  private static async commitCashOut(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
  ) {
    const rawAmount =
      row.amount != null && !isNaN(Number(row.amount))
        ? Math.abs(Number(row.amount))
        : 0;
    if (rawAmount <= 0) {
      throw new BadRequestError("INVALID_AMOUNT", "Amount must be greater than 0");
    }
    const reason = (row.purpose || row.note || "Cash Out").trim();
    const createdAt = startOfDateCairo(dateKey);
    await Refund.create({
      type: "CASHOUT",
      reason,
      amount: rawAmount,
      memberName: null,
      memberId: null,
      paymentId: null,
      locationId,
      createdAt,
    });
  }

  private static async commitMemberRefund(
    row: SheetCommitRow,
    dateKey: string,
    locationId: string,
  ) {
    const rawAmount =
      row.amount != null && !isNaN(Number(row.amount))
        ? Math.abs(Number(row.amount))
        : 0;
    if (rawAmount <= 0) {
      throw new BadRequestError("INVALID_AMOUNT", "Amount must be greater than 0");
    }
    const person = await this.resolvePerson(row, { allowGuest: true });
    const reason = (row.purpose || row.note || "Refund").trim();
    const createdAt = startOfDateCairo(dateKey);
    await Refund.create({
      type: "REFUND",
      reason,
      amount: rawAmount,
      memberName:
        person.kind === "member" ? row.name.trim() : (person.name || row.name.trim()),
      memberId: person.kind === "member" ? new Types.ObjectId(person.uid) : null,
      paymentId: null,
      locationId,
      createdAt,
    });
  }
}
