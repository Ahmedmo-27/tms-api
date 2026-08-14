/**
 * Shared helpers for North Coast Excel imports
 * (La Vista Ras El Hekma members + Matcha/Hekma daily check-ins).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { Types } from "mongoose";
import Location from "../models/location";
import Package, {
  getPackageEndDate,
  isUnlimitedSpaceAccess,
} from "../models/package";
import User from "../models/user";
import Member from "../models/member";
import Payment from "../models/payment";
import { cairoDayRange } from "../utils/timezone";

export const HEKMA_LOCATION_ID = "6a3e9547c72a8d349f150911";
export const GUEST_PASSWORD = "ImportTemp1!";
export const IMPORT_YEAR = 2026;

export const MEMBERS_XLSX = path.join(
  __dirname,
  "../../(revised) La Vista Ras El Hekma Members 2026.xlsx",
);
export const CHECKINS_XLSX = path.join(
  __dirname,
  "../../(revised) Ras el hekma and Matcha Daliy Check ins_.xlsx",
);

export const GUEST_REGISTRY_PATH = path.join(
  __dirname,
  "../../recovery/nc-guest-registry.json",
);

/** Excel normalized key → { catalogName, endOverrideDays? } */
export interface PackageMapEntry {
  catalogName: string;
  /** If set, pkgEndDate = start + N days instead of catalog expiryPeriod */
  endOverrideDays?: number;
}

/**
 * Maps North Coast spreadsheet package labels onto existing Cairo catalog names.
 * UMS = Ultimate Mindspacer.
 */
export const PACKAGE_MAP: Record<string, PackageMapEntry> = {
  // UMS / Ultimate
  "1 week ums": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "1 week": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "1 week ums ": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "2 week ums": {
    catalogName: "1 Month Ultimate Mindspacer",
    endOverrideDays: 14,
  },
  "2 weeks ums": {
    catalogName: "1 Month Ultimate Mindspacer",
    endOverrideDays: 14,
  },
  "2 weeks ums ": {
    catalogName: "1 Month Ultimate Mindspacer",
    endOverrideDays: 14,
  },
  "1 month": { catalogName: "1 Month Ultimate Mindspacer" },
  "1 month ums": { catalogName: "1 Month Ultimate Mindspacer" },
  "1 month ums ": { catalogName: "1 Month Ultimate Mindspacer" },

  // Classes → Studio / FT
  "5 classes": { catalogName: "5 Studio" },
  "5": { catalogName: "5 Studio" },
  "10 classes": { catalogName: "10 Studio" },
  "10": { catalogName: "10 Studio" },
  "15 classes": { catalogName: "15 Studio" },
  "15": { catalogName: "15 Studio" },
  "20 classes": { catalogName: "20 Functional Training" },
  "20": { catalogName: "20 Functional Training" },

  // Space / open gym
  "1 week space": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "1 week open": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "1 week space for both": { catalogName: "The Ultimate Mind Spacer 1 Week" },
  "2 weeks space": {
    catalogName: "1 Month Space Membership New Cairo",
    endOverrideDays: 14,
  },
  "1 month space": { catalogName: "1 Month Space Membership New Cairo" },
  "1 month space ( 1 week freeze)": {
    catalogName: "1 Month Space Membership New Cairo",
  },
  "2 month space": { catalogName: "3 Month Ultimate Mindspacer" },
  "whole summer space": { catalogName: "3 Month Ultimate Mindspacer" },
};

export type PaymentMethodEnum =
  | "APP"
  | "VISA"
  | "CASH"
  | "INSTAPAY"
  | "VALU"
  | "PAYMENT_LINK"
  | "DEDUCTED";

export interface FlaggedRow {
  source: string;
  name: string;
  phone?: string;
  flags: string[];
}

export interface ImportStats {
  usersCreated: number;
  membersCreated: number;
  packagesAdded: number;
  paymentsCreated: number;
  guestsCreated: number;
  skippedDuplicate: number;
  skippedBlocking: number;
  scheduledClassesCreated: number;
  bookingsCreated: number;
  openGymRecorded: number;
}

export function emptyStats(): ImportStats {
  return {
    usersCreated: 0,
    membersCreated: 0,
    packagesAdded: 0,
    paymentsCreated: 0,
    guestsCreated: 0,
    skippedDuplicate: 0,
    skippedBlocking: 0,
    scheduledClassesCreated: 0,
    bookingsCreated: 0,
    openGymRecorded: 0,
  };
}

export function isApplyMode(): boolean {
  return process.argv.includes("--apply");
}

export function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && Number.isFinite(v) && v === Math.floor(v)) {
    return String(Math.trunc(v));
  }
  return String(v).trim();
}

export function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ums/g, "ums")
    .trim();
}

/** Normalize package label from Excel into a PACKAGE_MAP key. */
export function normalizePackageLabel(raw: string): string {
  let s = normalizeKey(raw);
  s = s.replace(/\s+/g, " ");
  // "10 classes classes" / "5.0 classes" / "10 classes"
  const classesMatch = s.match(/^(\d+(?:\.\d+)?)\s*classes?$/);
  if (classesMatch) {
    return `${parseInt(classesMatch[1], 10)} classes`;
  }
  const bareNum = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bareNum) return String(parseInt(bareNum[1], 10));
  // strip trailing notes like freeze
  s = s.replace(/\s*\(.*freeze.*\)\s*/i, " ").trim();
  return s;
}

export function mapPackageLabel(
  raw: string,
): PackageMapEntry | null {
  const key = normalizePackageLabel(raw);
  if (PACKAGE_MAP[key]) return PACKAGE_MAP[key];
  // fuzzy: contains week/month ums/space
  if (/whole\s*summer/.test(key)) return PACKAGE_MAP["whole summer space"];
  if (/2\s*month\s*space/.test(key)) return PACKAGE_MAP["2 month space"];
  if (/1\s*month\s*space/.test(key)) return PACKAGE_MAP["1 month space"];
  if (/2\s*weeks?\s*space/.test(key)) return PACKAGE_MAP["2 weeks space"];
  if (/1\s*week\s*(space|open)/.test(key)) return PACKAGE_MAP["1 week space"];
  if (/2\s*weeks?\s*ums/.test(key)) return PACKAGE_MAP["2 weeks ums"];
  if (/1\s*week\s*ums/.test(key) || /^1\s*week$/.test(key))
    return PACKAGE_MAP["1 week ums"];
  if (/1\s*month\s*ums/.test(key) || /^1\s*month$/.test(key))
    return PACKAGE_MAP["1 month ums"];
  if (/(\d+)\s*classes?/.test(key)) {
    const n = parseInt(RegExp.$1, 10);
    return PACKAGE_MAP[`${n} classes`] ?? null;
  }
  return null;
}

export function mapPaymentMethod(
  raw: string,
): { method: PaymentMethodEnum | null; noteExtra?: string; flag?: string } {
  const s = normalizeKey(raw);
  if (!s) return { method: null, flag: "MISSING_PAYMENT_METHOD" };
  if (s.includes("visa") && s.includes("cash"))
    return { method: "VISA", noteExtra: "visa + cash" };
  if (s.includes("visa")) return { method: "VISA" };
  if (s.includes("cash")) return { method: "CASH" };
  if (s.includes("insta")) return { method: "INSTAPAY" };
  if (s.includes("payment link") || s === "link")
    return { method: "PAYMENT_LINK" };
  if (s === "app") return { method: "APP" };
  if (s.includes("valu")) return { method: "VALU" };
  // Misplaced package name in method column
  if (/ums|space|week|month|class/.test(s))
    return { method: null, flag: `METHOD_LOOKS_LIKE_PACKAGE:${raw}` };
  return { method: null, flag: `UNKNOWN_PAYMENT_METHOD:${raw}` };
}

export function normalizePhone(
  raw: unknown,
): { phone: string | null; isGuest: boolean; flag?: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { phone: null, isGuest: true, flag: "MISSING_PHONE" };
  }
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0)
    return { phone: null, isGuest: true, flag: "MISSING_PHONE" };
  if (digits.length === 10)
    return { phone: "0" + digits, isGuest: false };
  if (digits.length === 11 && digits.startsWith("0"))
    return { phone: digits, isGuest: false };
  return {
    phone: null,
    isGuest: true,
    flag: `INVALID_PHONE:${raw}`,
  };
}

export function parseExcelDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return new Date(
      raw.getFullYear(),
      raw.getMonth(),
      raw.getDate(),
      12,
      0,
      0,
    );
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0);
    }
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : IMPORT_YEAR;
    const d = new Date(year, month - 1, day, 12, 0, 0);
    if (!isNaN(d.getTime()) && d.getMonth() === month - 1) return d;
  }
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) {
    return new Date(
      iso.getFullYear(),
      iso.getMonth(),
      iso.getDate(),
      12,
      0,
      0,
    );
  }
  return null;
}

export function countVisitDates(cells: unknown[]): number {
  let n = 0;
  for (const c of cells) {
    if (c === null || c === undefined || c === "") continue;
    if (c instanceof Date) {
      n++;
      continue;
    }
    if (typeof c === "number" && c > 40000 && c < 60000) {
      n++;
      continue;
    }
    const s = String(c).trim();
    if (!s) continue;
    // skip notes that aren't dates
    if (/switch|freeze|reformer|pilates|member|will pay|foc/i.test(s) && !/\d/.test(s))
      continue;
    if (parseExcelDate(c)) n++;
    else if (/^\d{1,2}[\/\-]\d{1,2}/.test(s)) n++;
  }
  return n;
}

export function readWorkbook(filePath: string): XLSX.WorkBook {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  return XLSX.readFile(filePath, { cellDates: true });
}

export function sheetToRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
}

export type GuestRegistry = Record<
  string,
  { phone: string; name: string; locationId: string }
>;

export function loadGuestRegistry(): GuestRegistry {
  try {
    if (fs.existsSync(GUEST_REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(GUEST_REGISTRY_PATH, "utf-8"));
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function saveGuestRegistry(reg: GuestRegistry): void {
  const dir = path.dirname(GUEST_REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GUEST_REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

function guestKey(name: string, locationId: string): string {
  const norm = name.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto
    .createHash("sha1")
    .update(`${norm}|${locationId}`)
    .digest("hex")
    .slice(0, 16);
}

/** Allocate a stable synthetic 11-digit phone 0999XXXXXXX */
export function allocateGuestPhone(
  registry: GuestRegistry,
  name: string,
  locationId: string,
): string {
  const key = guestKey(name, locationId);
  if (registry[key]) return registry[key].phone;

  const used = new Set(Object.values(registry).map((r) => r.phone));
  // Also avoid colliding with a short hash-derived candidate
  let seq = parseInt(key.slice(0, 7), 16) % 10_000_000;
  for (let i = 0; i < 10_000_000; i++) {
    const candidate = `0999${String((seq + i) % 10_000_000).padStart(7, "0")}`;
    if (!used.has(candidate)) {
      registry[key] = {
        phone: candidate,
        name: `Guest: ${name.trim()}`,
        locationId,
      };
      return candidate;
    }
  }
  throw new Error("Exhausted guest phone namespace");
}

export async function resolveHekmaLocation(): Promise<{
  id: string;
  branchName: string;
}> {
  const loc = await Location.findById(HEKMA_LOCATION_ID);
  if (!loc) {
    throw new Error(
      `Hekma location ${HEKMA_LOCATION_ID} not found in Location collection`,
    );
  }
  if (!/ras\s*el\s*hekma|la\s*vista/i.test(loc.branchName + " " + loc.location)) {
    console.warn(
      `[WARN] Hekma id points to unexpected name: ${loc.branchName} / ${loc.location}`,
    );
  }
  return { id: String(loc._id), branchName: loc.branchName };
}

export async function resolveMatchaLocation(): Promise<{
  id: string;
  branchName: string;
}> {
  const loc = await Location.findOne({
    branchName: { $regex: /^Matcha$/i },
  });
  if (!loc) {
    throw new Error('Matcha location (branchName /^Matcha$/i) not found');
  }
  return { id: String(loc._id), branchName: loc.branchName };
}

export async function loadPackageCatalog(): Promise<
  Map<string, InstanceType<typeof Package>>
> {
  const all = await Package.find({});
  const byName = new Map<string, InstanceType<typeof Package>>();
  for (const p of all) {
    byName.set(p.name, p);
  }
  return byName;
}

export function resolveEndDate(
  start: Date,
  pkg: { expiryPeriod: number },
  entry: PackageMapEntry,
): Date {
  if (entry.endOverrideDays != null) {
    return new Date(
      start.getTime() + entry.endOverrideDays * 24 * 60 * 60 * 1000,
    );
  }
  return getPackageEndDate(start, pkg);
}

export function computeRemaining(
  pkg: { numberOfSessions: number; category: string },
  visitCount: number,
): number {
  if (isUnlimitedSpaceAccess(pkg.category)) {
    return pkg.numberOfSessions;
  }
  return Math.max(0, pkg.numberOfSessions - visitCount);
}

export interface EnsuredUser {
  user: InstanceType<typeof User>;
  member: InstanceType<typeof Member>;
  createdUser: boolean;
  createdMember: boolean;
  isGuest: boolean;
  phone: string;
}

/** In-memory cache so bulk imports don't re-query the same phone repeatedly. */
const userCacheByPhone = new Map<string, EnsuredUser>();

export function clearUserCache(): void {
  userCacheByPhone.clear();
}

/**
 * Find or create User + Member. Guests get synthetic phones and "Guest: name".
 */
export async function ensureUserAndMember(opts: {
  name: string;
  rawPhone: unknown;
  locationId: string;
  registry: GuestRegistry;
  dryRun: boolean;
  stats: ImportStats;
}): Promise<EnsuredUser | null> {
  const trimmed = opts.name.trim();
  if (!trimmed) return null;

  const phoneInfo = normalizePhone(opts.rawPhone);
  let phone: string;
  let displayName = trimmed;
  let isGuest = false;

  if (phoneInfo.isGuest || !phoneInfo.phone) {
    isGuest = true;
    phone = allocateGuestPhone(opts.registry, trimmed, opts.locationId);
    displayName = `Guest: ${trimmed}`;
  } else {
    phone = phoneInfo.phone;
  }

  const cached = userCacheByPhone.get(phone);
  if (cached) return cached;

  let user = opts.dryRun ? null : await User.findOne({ phoneNumber: phone });
  let createdUser = false;
  let createdMember = false;

  if (!user) {
    createdUser = true;
    opts.stats.usersCreated++;
    if (isGuest) opts.stats.guestsCreated++;
    if (!opts.dryRun) {
      user = new User({
        name: isGuest ? displayName : trimmed,
        email: isGuest
          ? `guest-${phone}@import.local`
          : `nc-${phone}@import.local`,
        phoneNumber: phone,
        password: GUEST_PASSWORD,
        role: "member",
        locationId: new Types.ObjectId(opts.locationId),
      });
      await user.save();
    } else {
      user = {
        _id: new Types.ObjectId(),
        name: isGuest ? displayName : trimmed,
        phoneNumber: phone,
      } as InstanceType<typeof User>;
    }
  }

  let member = opts.dryRun
    ? null
    : await Member.findOne({ uid: user._id });
  if (!member) {
    createdMember = true;
    opts.stats.membersCreated++;
    if (!opts.dryRun) {
      member = new Member({
        uid: user._id,
        packages: [],
        bookings: [],
        attendance: [],
        ptAttendance: [],
        isActive: true,
      });
      await member.save();
    } else {
      member = {
        _id: new Types.ObjectId(),
        uid: user._id,
        packages: [],
      } as unknown as InstanceType<typeof Member>;
    }
  }

  const ensured: EnsuredUser = {
    user,
    member,
    createdUser,
    createdMember,
    isGuest,
    phone,
  };
  userCacheByPhone.set(phone, ensured);
  return ensured;
}

export async function paymentExists(opts: {
  uid?: string;
  phone?: string;
  amount: number;
  locationId: string;
  paymentTime: Date;
  notePrefix: string;
}): Promise<boolean> {
  const { start, end } = cairoDayRange(opts.paymentTime);
  const q: Record<string, unknown> = {
    amount: opts.amount,
    locationId: new Types.ObjectId(opts.locationId),
    paymentTime: { $gte: start, $lt: end },
    note: { $regex: opts.notePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") },
  };
  if (opts.uid) q.uid = new Types.ObjectId(opts.uid);
  else if (opts.phone) q.nonMemberPhone = opts.phone;
  const existing = await Payment.findOne(q);
  return !!existing;
}

export async function addMemberPackageWithPayment(opts: {
  uid: string;
  phone: string;
  name: string;
  pkg: InstanceType<typeof Package>;
  mapEntry: PackageMapEntry;
  startDate: Date;
  amount: number;
  paymentMethod: PaymentMethodEnum;
  locationId: string;
  remainingClasses: number;
  note: string;
  dryRun: boolean;
  stats: ImportStats;
  noteExtra?: string;
}): Promise<"added" | "duplicate" | "blocked"> {
  const startIso = opts.startDate.toISOString();
  const { start, end } = cairoDayRange(opts.startDate);

  const existingPkg = await Member.findOne({
    uid: opts.uid,
    packages: {
      $elemMatch: {
        pkgId: opts.pkg._id,
        pkgStartDate: { $gte: start, $lt: end },
      },
    },
  });
  if (existingPkg) {
    opts.stats.skippedDuplicate++;
    return "duplicate";
  }

  if (
    await paymentExists({
      uid: opts.uid,
      amount: opts.amount,
      locationId: opts.locationId,
      paymentTime: opts.startDate,
      notePrefix: "NC import",
    })
  ) {
    // Payment exists but package might not — still try addPackageIfAbsent below on apply
  }

  const endDate = resolveEndDate(opts.startDate, opts.pkg, opts.mapEntry);
  const fullNote = opts.noteExtra
    ? `${opts.note} (${opts.noteExtra})`
    : opts.note;

  if (opts.dryRun) {
    opts.stats.paymentsCreated++;
    opts.stats.packagesAdded++;
    return "added";
  }

  const payment = new Payment({
    uid: new Types.ObjectId(opts.uid),
    amount: opts.amount,
    paymentMethod: opts.paymentMethod,
    paymentTime: opts.startDate,
    purpose: "PACKAGE",
    pkgId: opts.pkg._id,
    note: fullNote,
    isRefunded: false,
    locationId: new Types.ObjectId(opts.locationId),
  });
  await payment.save();
  opts.stats.paymentsCreated++;

  const added = await attachPackageNoSession({
    uid: opts.uid,
    pkgId: String(opts.pkg._id),
    pkgName: opts.pkg.name,
    remainingClasses: opts.remainingClasses,
    startDate: startIso,
    endDate: endDate.toISOString(),
    locationId: opts.locationId,
  });

  if (!added) {
    opts.stats.skippedDuplicate++;
    return "duplicate";
  }

  opts.stats.packagesAdded++;
  return "added";
}

/**
 * addPackageIfAbsent requires a session in its type signature but works without.
 * Provide a thin wrapper that avoids passing null.
 */
export async function attachPackageNoSession(opts: {
  uid: string;
  pkgId: string;
  pkgName: string;
  remainingClasses: number;
  startDate: string;
  endDate: string;
  locationId: string;
}): Promise<boolean> {
  const { start, end } = cairoDayRange(opts.startDate);
  const result = await Member.findOneAndUpdate(
    {
      uid: opts.uid,
      packages: {
        $not: {
          $elemMatch: {
            pkgId: new Types.ObjectId(opts.pkgId),
            pkgStartDate: { $gte: start, $lt: end },
          },
        },
      },
    },
    {
      $push: {
        packages: {
          pkgId: new Types.ObjectId(opts.pkgId),
          name: opts.pkgName,
          pkgStartDate: new Date(opts.startDate),
          pkgEndDate: new Date(opts.endDate),
          status: "ACTIVE",
          remainingClasses: opts.remainingClasses,
          locationId: new Types.ObjectId(opts.locationId),
        },
      },
    },
    { new: true },
  );
  return !!result;
}

export function writeReport(fileName: string, data: unknown): string {
  const out = path.join(__dirname, "../../recovery", fileName);
  const dir = path.dirname(out);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  return out;
}

/** Parse sheet name like "57 Hekma", "167Matcha", "297 matcha" → date + location kind */
export function parseCheckinSheetName(
  sheetName: string,
): { date: Date; locationKind: "Hekma" | "Matcha" } | null {
  const s = sheetName.trim();
  if (/^sheet\d+$/i.test(s)) return null;

  const m = s.match(/^(\d{1,2})\s*\/?\s*(\d)?\s*(Hekma|Matcha)\s*$/i);
  // Patterns: "57 Hekma" = day 5 month 7; "167 Hekma" = day 16 month 7; "277 Matcha"
  // Sheet names are like: 27 Matcha, 57 Hekma, 107 Hekma, 167Hekma, 297 matcha
  const m2 = s.match(/^(\d{1,2})(\d)?\s*(Hekma|Matcha)\s*$/i);
  // Actually looking at names: "27 Matcha" = 2/7, "57 Hekma" = 5/7, "107 Hekma" = 10/7,
  // "127 Matcha" = 12/7, "297 matcha" = 29/7
  // So it's: day digits then month digit (always 7 for July), then location.
  // "27" → day 2, month 7; "107" → day 10, month 7; "167" → day 16 month 7
  const m3 = s.match(/^(\d+)(Hekma|Matcha)\s*$/i); // 167Hekma
  const m4 = s.match(/^(\d+)\s+(Hekma|Matcha)\s*$/i);

  let digits: string | null = null;
  let locRaw: string | null = null;
  if (m4) {
    digits = m4[1];
    locRaw = m4[2];
  } else if (m3) {
    digits = m3[1];
    locRaw = m3[2];
  } else if (m2) {
    digits = (m2[1] || "") + (m2[2] || "");
    locRaw = m2[3];
  } else if (m) {
    digits = m[1] + (m[2] || "");
    locRaw = m[3];
  }
  if (!digits || !locRaw) return null;

  // Last digit is month, preceding are day
  if (digits.length < 2) return null;
  const month = parseInt(digits.slice(-1), 10);
  const day = parseInt(digits.slice(0, -1), 10);
  if (!day || !month || month < 1 || month > 12 || day < 1 || day > 31)
    return null;

  const locationKind = /^matcha$/i.test(locRaw) ? "Matcha" : "Hekma";
  const date = new Date(IMPORT_YEAR, month - 1, day, 12, 0, 0);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, locationKind };
}

export function isDropInPurpose(raw: string): boolean {
  const s = normalizeKey(raw);
  return /drop\s*in|dropin|walk\s*in|walkin/.test(s);
}

export function isMemberMarker(raw: string): boolean {
  const s = normalizeKey(raw);
  if (!s) return false;
  return (
    s === "member" ||
    s === "ums member" ||
    s === "paid" ||
    s === "foc" ||
    /ums\s*member/.test(s) ||
    /^will\s*pay/.test(s)
  );
}

export function isClassHeader(raw: string): boolean {
  const s = normalizeKey(raw);
  if (!s) return false;
  if (
    /^(no|names?|phone|payment|package|method|purpose|number|membership|space|open gym|classes|matcha|la vista)/i.test(
      s,
    )
  )
    return false;
  return (
    /pilates|reformer|functional|ft\b|mat\b|strength|juniors|50\s*&\s*fab|yoga|hiit|sculpt|barre|spin|circuit|open\s*gym/i.test(
      s,
    ) || /\d{1,2}\s*[:.]\s*\d{2}/.test(s) || /\d{1,2}\s*(am|pm)/i.test(s)
  );
}

/** Extract HH:MM from a class header like "Pilates 11am" / "Reformer 12:00 PM" / "FT 11:00 AM" */
export function parseClassTime(
  header: string,
): { hours: number; minutes: number } | null {
  const s = header.toLowerCase();
  let m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const ap = m[3];
    if (ap === "pm" && hours < 12) hours += 12;
    if (ap === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  m = s.match(/(\d{1,2})\s*(am|pm)/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const ap = m[2];
    if (ap === "pm" && hours < 12) hours += 12;
    if (ap === "am" && hours === 12) hours = 0;
    return { hours, minutes: 0 };
  }
  return null;
}

export function classStartOnDate(
  date: Date,
  time: { hours: number; minutes: number } | null,
): Date {
  const d = new Date(date);
  if (time) {
    d.setHours(time.hours, time.minutes, 0, 0);
  } else {
    d.setHours(10, 0, 0, 0);
  }
  return d;
}
