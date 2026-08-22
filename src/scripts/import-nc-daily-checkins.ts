/**
 * import-nc-daily-checkins.ts
 *
 * Imports Ras el Hekma + Matcha daily check-in workbook:
 *   - PACKAGE / DROPIN payments
 *   - Open-gym / space DailyAttendance (historical dates)
 *   - Stub ScheduledClass + book + scan for class attendees
 *
 * Does NOT re-debit member packages (Phase A already counted visits).
 *
 * Usage:
 *   npx ts-node src/scripts/import-nc-daily-checkins.ts --dry-run
 *   npx ts-node src/scripts/import-nc-daily-checkins.ts --apply
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";
import ScheduledClass from "../models/scheduledClass";
import DailyAttendance from "../models/dailyAttendance";
import Member from "../models/member";
import Payment from "../models/payment";
import {
  CHECKINS_XLSX,
  attachPackageNoSession,
  cellStr,
  classStartOnDate,
  computeRemaining,
  emptyStats,
  ensureUserAndMember,
  clearUserCache,
  isApplyMode,
  isClassHeader,
  isDropInPurpose,
  isMemberMarker,
  loadGuestRegistry,
  loadPackageCatalog,
  mapPackageLabel,
  mapPaymentMethod,
  normalizeKey,
  parseCheckinSheetName,
  parseClassTime,
  parseExcelDate,
  readWorkbook,
  resolveEndDate,
  resolveHekmaLocation,
  resolveMatchaLocation,
  saveGuestRegistry,
  sheetToRows,
  writeReport,
  type FlaggedRow,
  type GuestRegistry,
  type ImportStats,
  type PaymentMethodEnum,
} from "./import-nc-shared";
import { cairoDayRange, startOfDateCairo } from "../utils/timezone";

type SectionKind = "class" | "open_gym" | "unknown";

interface CheckinPerson {
  sheet: string;
  sheetDate: Date;
  locationId: string;
  locationKind: "Hekma" | "Matcha";
  section: SectionKind;
  classTitle?: string;
  classTime?: { hours: number; minutes: number } | null;
  name: string;
  rawPhone: unknown;
  membershipOrPurpose: string;
  amount: number | null;
  methodRaw: string;
  purposeRaw: string;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial dates are large; amounts for NC are typically < 100000
    if (raw > 100000) return null;
    return raw;
  }
  const s = String(raw).trim();
  if (!s || /member|will pay|foc|paid/i.test(s)) return null;
  const n = parseFloat(s.replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function looksLikePhone(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

function looksLikeName(raw: unknown): boolean {
  const s = cellStr(raw);
  if (!s || s.length < 2) return false;
  if (/^(no|name|names|phone|payment|package|method|purpose|number|membership|space|open gym|classes|matcha|la vista)$/i.test(s))
    return false;
  if (isClassHeader(s)) return false;
  if (/^\d+(\.\d+)?$/.test(s)) return false;
  return /[a-zA-Z]/.test(s);
}

/** Detect column layout from header row and extract people rows. */
function extractPeopleFromSheet(
  sheetName: string,
  rows: unknown[][],
  sheetDate: Date,
  locationId: string,
  locationKind: "Hekma" | "Matcha",
): CheckinPerson[] {
  const people: CheckinPerson[] = [];
  if (!rows.length) return people;

  const header = (rows[0] || []).map((c) => normalizeKey(cellStr(c)));

  // Detect dual open-gym column start
  let openGymStart = -1;
  for (let c = 0; c < header.length; c++) {
    if (
      header[c] === "open gym" ||
      header[c] === "space" ||
      (header[c] === "name" && c >= 8 && openGymStart < 0)
    ) {
      // Prefer explicit open gym / space labels
      if (header[c] === "open gym" || header[c] === "space") {
        openGymStart = c;
        break;
      }
    }
  }
  // Also scan row 0 for "space" / "Open Gym" in any cell
  for (let c = 0; c < (rows[0] || []).length; c++) {
    const v = normalizeKey(cellStr(rows[0][c]));
    if (v === "open gym" || v === "space") {
      openGymStart = c;
      break;
    }
  }

  // Layout A: MATCHA | name | number | purpose | payment | method
  const isMatchaSimple =
    header[0] === "matcha" ||
    (header[1] === "name" && header[2] === "number" && header[3] === "purpose");

  // Layout B: Classes | Name | Membership | Payment | Method | Purpose | Number
  const isClassesLayout =
    header[0] === "classes" ||
    (header[1] === "name" &&
      (header[2] === "membership" || header[5] === "purpose"));

  // Layout C: early Matcha — blank | Name | Membership | Payment | Method | purpose | Number
  const isEarlyMatcha =
    header[1] === "name" &&
    (header[2] === "membership" || header[5] === "purpose" || header[6] === "number");

  let currentClassTitle: string | undefined;
  let currentClassTime: { hours: number; minutes: number } | null = null;
  let currentSection: SectionKind = "class";

  const pushPerson = (
    name: string,
    rawPhone: unknown,
    membershipOrPurpose: string,
    amount: number | null,
    methodRaw: string,
    purposeRaw: string,
    section: SectionKind,
    classTitle?: string,
    classTime?: { hours: number; minutes: number } | null,
  ) => {
    if (!looksLikeName(name)) return;
    people.push({
      sheet: sheetName,
      sheetDate,
      locationId,
      locationKind,
      section,
      classTitle,
      classTime,
      name: name.trim(),
      rawPhone,
      membershipOrPurpose,
      amount,
      methodRaw,
      purposeRaw,
    });
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];

    // Class / section headers can appear in col 0 or as standalone
    for (const col of [0, 8, 9, 11]) {
      const h = cellStr(row[col]);
      if (!h) continue;
      if (/^open\s*gym$/i.test(h) || /^space$/i.test(h)) {
        currentSection = "open_gym";
        continue;
      }
      if (/^classes$/i.test(h)) {
        currentSection = "class";
        continue;
      }
      if (isClassHeader(h) && !looksLikePhone(h)) {
        currentClassTitle = h;
        currentClassTime = parseClassTime(h);
        currentSection = "class";
      }
    }

    // Skip pure header rows
    const row0 = normalizeKey(cellStr(row[0]));
    if (
      row0 === "no" ||
      row0 === "classes" ||
      row0 === "matcha" ||
      row0 === "la vista ras el hekma" ||
      row0 === "open gym" ||
      row0 === "space"
    ) {
      // may still have open-gym people on the right
    }

    if (isMatchaSimple && i > 0) {
      // Cols: 0 idx/header, 1 name, 2 number, 3 purpose, 4 payment, 5 method
      // OR: 0 class header, 1 name...
      const name = cellStr(row[1]);
      if (looksLikeName(name)) {
        const purpose = cellStr(row[3]);
        const payment = row[4];
        const method = cellStr(row[5]);
        const number = row[2];
        // Sometimes purpose/payment swapped vs early sheets
        let amount = parseAmount(payment);
        let purposeRaw = purpose;
        let methodRaw = method;
        let phone: unknown = looksLikePhone(number) ? number : null;
        // Early alternate: payment in col3 as number, purpose in col5
        if (amount == null && parseAmount(purpose) != null) {
          amount = parseAmount(purpose);
          purposeRaw = cellStr(row[5]) || cellStr(row[2]);
          methodRaw = cellStr(row[4]);
        }
        // Layout from 57 Matcha: name, number, purpose, payment, method
        if (looksLikePhone(number)) phone = number;
        pushPerson(
          name,
          phone,
          purposeRaw || cellStr(row[2]),
          amount,
          methodRaw,
          purposeRaw,
          currentSection,
          currentClassTitle,
          currentClassTime,
        );
      }
      continue;
    }

    // Generic: left block (class) + optional right block (open gym)
    const leftNameCol = isClassesLayout || isEarlyMatcha ? 1 : 1;
    const leftName = cellStr(row[leftNameCol]);

    // Determine left columns based on layout
    // Classes layout: 0=idx/title, 1=name, 2=membership, 3=payment, 4=method, 5=purpose, 6=number
    // Early: 0=idx, 1=name, 2=membership, 3=payment, 4=method, 5=purpose, 6=number
    // Hekma old: 0=idx, 1=name, 2=phone, 3=payment, 4=package, 5=method

    if (looksLikeName(leftName) && !isClassHeader(leftName)) {
      let membership = "";
      let amount: number | null = null;
      let methodRaw = "";
      let purposeRaw = "";
      let phone: unknown = null;

      const c2 = row[2];
      const c3 = row[3];
      const c4 = row[4];
      const c5 = row[5];
      const c6 = row[6];

      if (looksLikePhone(c2) && !looksLikePhone(c6)) {
        // Old Hekma: name, phone, payment, package, method
        phone = c2;
        amount = parseAmount(c3);
        purposeRaw = cellStr(c4);
        membership = cellStr(c3) === "member" ? "member" : cellStr(c3);
        methodRaw = cellStr(c5);
        if (isMemberMarker(cellStr(c3))) {
          membership = cellStr(c3);
          amount = null;
          purposeRaw = cellStr(c4);
        }
      } else {
        // Modern: membership, payment, method, purpose, number
        membership = cellStr(c2);
        amount = parseAmount(c3);
        methodRaw = cellStr(c4);
        purposeRaw = cellStr(c5);
        phone = looksLikePhone(c6) ? c6 : looksLikePhone(c2) ? c2 : null;

        // Matcha 177 quirk: name, phone, method, amount, purpose
        if (looksLikePhone(c2) && mapPaymentMethod(cellStr(c3)).method) {
          phone = c2;
          methodRaw = cellStr(c3);
          amount = parseAmount(c4);
          purposeRaw = cellStr(c5);
          membership = "";
        }

        // If membership is a phone
        if (looksLikePhone(c2) && !phone) phone = c2;
      }

      const sectionForLeft: SectionKind =
        currentSection === "open_gym" ? "open_gym" : "class";

      pushPerson(
        leftName,
        phone,
        purposeRaw || membership,
        amount,
        methodRaw,
        purposeRaw || membership,
        sectionForLeft,
        currentClassTitle,
        currentClassTime,
      );
    }

    // Right block (open gym / space)
    if (openGymStart >= 0) {
      // Variants:
      // openGymStart points at "Open Gym" or "space" label col;
      // name is usually openGymStart+1, or openGymStart itself if header was previous row
      let nameCol = openGymStart + 1;
      // If cell at openGymStart+1 is empty but openGymStart+2 looks like name...
      const candidates = [
        openGymStart + 1,
        openGymStart + 2,
        openGymStart,
      ];
      for (const nc of candidates) {
        if (looksLikeName(row[nc]) && !isClassHeader(cellStr(row[nc]))) {
          nameCol = nc;
          break;
        }
      }
      const rName = cellStr(row[nameCol]);
      if (!looksLikeName(rName) || isClassHeader(rName)) continue;

      // After name: membership, payment, method, purpose, number — order varies
      const after = row.slice(nameCol + 1, nameCol + 7);
      let membership = "";
      let amount: number | null = null;
      let methodRaw = "";
      let purposeRaw = "";
      let phone: unknown = null;

      for (const cell of after) {
        const s = cellStr(cell);
        if (!s) continue;
        if (looksLikePhone(cell) && !phone) {
          phone = cell;
          continue;
        }
        const amt = parseAmount(cell);
        if (amt != null && amount == null) {
          amount = amt;
          continue;
        }
        const pm = mapPaymentMethod(s);
        if (pm.method && !methodRaw) {
          methodRaw = s;
          continue;
        }
        if (isMemberMarker(s) || isDropInPurpose(s) || mapPackageLabel(s)) {
          if (!purposeRaw) purposeRaw = s;
          if (isMemberMarker(s)) membership = s;
          continue;
        }
        if (!membership && /member|foc|will pay/i.test(s)) membership = s;
      }

      pushPerson(
        rName,
        phone,
        purposeRaw || membership,
        amount,
        methodRaw,
        purposeRaw || membership,
        "open_gym",
      );
    } else {
      // Heuristic dual column without explicit header: name around col 9-12
      for (const nc of [9, 11, 12]) {
        const rName = cellStr(row[nc]);
        if (!looksLikeName(rName) || isClassHeader(rName)) continue;
        const after = row.slice(nc + 1, nc + 7);
        let amount: number | null = null;
        let methodRaw = "";
        let purposeRaw = "";
        let phone: unknown = null;
        let membership = "";
        for (const cell of after) {
          const s = cellStr(cell);
          if (!s) continue;
          if (looksLikePhone(cell) && !phone) {
            phone = cell;
            continue;
          }
          const amt = parseAmount(cell);
          if (amt != null && amount == null) {
            amount = amt;
            continue;
          }
          if (mapPaymentMethod(s).method && !methodRaw) {
            methodRaw = s;
            continue;
          }
          if (
            isMemberMarker(s) ||
            isDropInPurpose(s) ||
            mapPackageLabel(s)
          ) {
            if (!purposeRaw) purposeRaw = s;
            if (isMemberMarker(s)) membership = s;
          }
        }
        pushPerson(
          rName,
          phone,
          purposeRaw || membership,
          amount,
          methodRaw,
          purposeRaw || membership,
          "open_gym",
        );
        break;
      }
    }
  }

  return people;
}

type ClassCache = {
  byKey: Map<string, string>;
  all: { id: string; title: string }[];
  loaded: boolean;
};

async function ensureClassList(cache: ClassCache): Promise<void> {
  if (cache.loaded) return;
  const all = await Class.find({}).select("_id title").lean();
  cache.all = all.map((c) => ({ id: String(c._id), title: c.title }));
  cache.loaded = true;
}

async function findOrCreateImportClass(
  title: string,
  locationIds: string[],
  dryRun: boolean,
  cache: ClassCache,
): Promise<string> {
  const key = title.toLowerCase().replace(/\s+/g, " ").trim();
  if (cache.byKey.has(key)) return cache.byKey.get(key)!;

  await ensureClassList(cache);

  const tokens = key.split(/\s+/).filter((t) => t.length > 2);
  let best: { id: string; score: number } | null = null;
  for (const cls of cache.all) {
    const t = cls.title.toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (t.includes(tok)) score++;
    }
    if (
      (/pilates/.test(key) && /pilates/.test(t)) ||
      (/reformer/.test(key) && /reformer/.test(t)) ||
      (/functional|ft\b/.test(key) && /functional/.test(t))
    ) {
      score += 2;
    }
    if (!best || score > best.score) {
      best = { id: cls.id, score };
    }
  }
  if (best && best.score >= 2) {
    cache.byKey.set(key, best.id);
    return best.id;
  }

  const importTitle = `Import — ${title}`.slice(0, 120);
  const existingImport = cache.all.find((c) => c.title === importTitle);
  if (existingImport) {
    cache.byKey.set(key, existingImport.id);
    return existingImport.id;
  }

  if (dryRun) {
    const id = new Types.ObjectId().toString();
    cache.byKey.set(key, id);
    cache.all.push({ id, title: importTitle });
    return id;
  }

  const created = await Class.create({
    title: importTitle,
    category: /functional|ft\b|strength/i.test(title)
      ? "FUNCTIONAL_TRAINING"
      : "STUDIO",
    price: 750,
    locations: locationIds.map((id) => new Types.ObjectId(id)),
    points: 1,
    allowDropIn: true,
  });
  const id = String(created._id);
  cache.byKey.set(key, id);
  cache.all.push({ id, title: importTitle });
  return id;
}

async function findOrCreateScheduledClass(opts: {
  cid: string;
  locationId: string;
  startTime: Date;
  dryRun: boolean;
  stats: ImportStats;
  scCache: Map<string, string>;
}): Promise<string> {
  const cacheKey = `${opts.cid}|${opts.locationId}|${opts.startTime.toISOString()}`;
  if (opts.scCache.has(cacheKey)) return opts.scCache.get(cacheKey)!;

  const endTime = new Date(opts.startTime.getTime() + 60 * 60 * 1000);

  if (!opts.dryRun) {
    const existing = await ScheduledClass.findOne({
      cid: new Types.ObjectId(opts.cid),
      locationId: new Types.ObjectId(opts.locationId),
      startTime: opts.startTime,
    });
    if (existing) {
      const id = String(existing._id);
      opts.scCache.set(cacheKey, id);
      return id;
    }

    const sc = await ScheduledClass.create({
      cid: new Types.ObjectId(opts.cid),
      locationId: new Types.ObjectId(opts.locationId),
      startTime: opts.startTime,
      endTime,
      availableSlots: 100,
      bookedMembers: [],
      coachId: [],
      scans: [],
      waitlistedMembers: [],
      waitingList: [],
    });
    opts.stats.scheduledClassesCreated++;
    const id = String(sc._id);
    opts.scCache.set(cacheKey, id);
    return id;
  }

  opts.stats.scheduledClassesCreated++;
  const id = new Types.ObjectId().toString();
  opts.scCache.set(cacheKey, id);
  return id;
}

async function bookAndScan(opts: {
  scid: string;
  uid: string;
  method: string;
  dryRun: boolean;
  stats: ImportStats;
}): Promise<void> {
  if (opts.dryRun) {
    opts.stats.bookingsCreated++;
    return;
  }

  const sc = await ScheduledClass.findById(opts.scid);
  if (!sc) return;
  const already = sc.bookedMembers?.some(
    (b) => b.uid.toString() === opts.uid,
  );
  if (!already) {
    await ScheduledClass.updateOne(
      { _id: sc._id },
      {
        $push: {
          bookedMembers: {
            uid: new Types.ObjectId(opts.uid),
            method: opts.method,
          },
        },
        $inc: { availableSlots: -1 },
      },
    );
    opts.stats.bookingsCreated++;
  }

  const alreadyScan = sc.scans?.some(
    (s) => s.uid.toString() === opts.uid && s.status === true,
  );
  if (!alreadyScan) {
    await ScheduledClass.updateOne(
      { _id: opts.scid },
      {
        $push: {
          scans: {
            uid: new Types.ObjectId(opts.uid),
            scanTime: sc.startTime,
            method: "NC_IMPORT",
            status: true,
          },
        },
      },
    );
  }

  // Member.attendance
  await Member.updateOne(
    {
      uid: opts.uid,
      attendance: {
        $not: { $elemMatch: { scid: new Types.ObjectId(opts.scid) } },
      },
    },
    { $push: { attendance: { scid: new Types.ObjectId(opts.scid) } } },
  );
}

async function recordHistoricalOpenGym(opts: {
  date: Date;
  uid?: string;
  guestName?: string;
  guestPhone?: string;
  locationId: string;
  dryRun: boolean;
  stats: ImportStats;
}): Promise<void> {
  const dayStart = startOfDateCairo(opts.date);
  const { start, end } = cairoDayRange(opts.date);

  if (opts.dryRun) {
    opts.stats.openGymRecorded++;
    return;
  }

  let day = await DailyAttendance.findOne({
    date: { $gte: start, $lt: end },
  });
  if (!day) {
    day = await DailyAttendance.create({
      date: dayStart,
      ptAttendance: [],
      openGymAttendance: [],
    });
  }

  const already = day.openGymAttendance.some((e) => {
    if (e.status !== "SUCCESS") return false;
    if (
      opts.locationId &&
      e.locationId &&
      e.locationId.toString() !== opts.locationId
    )
      return false;
    if (opts.uid && e.uid?.toString() === opts.uid) return true;
    if (opts.guestPhone && e.guestPhone === opts.guestPhone) return true;
    return false;
  });
  if (already) return;

  const entry: Record<string, unknown> = {
    time: new Date(opts.date.getTime() + 12 * 60 * 60 * 1000),
    method: "NC_IMPORT",
    status: "SUCCESS",
    locationId: new Types.ObjectId(opts.locationId),
  };
  if (opts.uid) entry.uid = new Types.ObjectId(opts.uid);
  if (opts.guestName) entry.guestName = opts.guestName;
  if (opts.guestPhone) entry.guestPhone = opts.guestPhone;

  await DailyAttendance.updateOne(
    { _id: day._id },
    { $push: { openGymAttendance: entry } },
  );
  opts.stats.openGymRecorded++;
}

async function processPerson(
  p: CheckinPerson,
  ctx: {
    catalog: Awaited<ReturnType<typeof loadPackageCatalog>>;
    registry: GuestRegistry;
    dryRun: boolean;
    stats: ImportStats;
    flagged: FlaggedRow[];
    classCache: ClassCache;
    scCache: Map<string, string>;
    hekmaId: string;
    matchaId: string;
  },
): Promise<void> {
  const flags: string[] = [];
  const purpose = p.purposeRaw || p.membershipOrPurpose;
  const purposeKey = normalizeKey(purpose);

  const ensured = await ensureUserAndMember({
    name: p.name,
    rawPhone: p.rawPhone,
    locationId: p.locationId,
    registry: ctx.registry,
    dryRun: ctx.dryRun,
    stats: ctx.stats,
  });
  if (!ensured) {
    ctx.stats.skippedBlocking++;
    return;
  }
  if (ensured.isGuest) flags.push("GUEST");

  const uid = String(ensured.user._id);
  const isDropIn = isDropInPurpose(purpose);
  const mapEntry = purpose ? mapPackageLabel(purpose) : null;
  const isMemberOnly =
    isMemberMarker(purpose) ||
    (!isDropIn && !mapEntry && (p.amount == null || p.amount <= 0));

  // Package sale on check-in sheet
  if (mapEntry && p.amount != null && p.amount > 0 && !isDropIn) {
    let pkg = ctx.catalog.get(mapEntry.catalogName);
    if (!pkg) {
      for (const [name, doc] of ctx.catalog) {
        if (name.toLowerCase() === mapEntry.catalogName.toLowerCase()) {
          pkg = doc;
          break;
        }
      }
    }
    if (!pkg) {
      flags.push(`PACKAGE_NOT_IN_DB:${mapEntry.catalogName}`);
      ctx.flagged.push({
        source: `${p.sheet}:${p.name}`,
        name: p.name,
        flags,
      });
      ctx.stats.skippedBlocking++;
    } else {
      const methodInfo = mapPaymentMethod(p.methodRaw);
      const method: PaymentMethodEnum = methodInfo.method || "VISA";
      const startDate = p.sheetDate;
      const { start, end } = cairoDayRange(startDate);
      const existing = ctx.dryRun
        ? null
        : await Member.findOne({
            uid,
            packages: {
              $elemMatch: {
                pkgId: pkg._id,
                pkgStartDate: { $gte: start, $lt: end },
              },
            },
          });
      if (existing) {
        ctx.stats.skippedDuplicate++;
      } else if (ctx.dryRun) {
        ctx.stats.paymentsCreated++;
        ctx.stats.packagesAdded++;
      } else {
        const endDate = resolveEndDate(startDate, pkg, mapEntry);
        await Payment.create({
          uid: new Types.ObjectId(uid),
          amount: p.amount,
          paymentMethod: method,
          paymentTime: startDate,
          purpose: "PACKAGE",
          pkgId: pkg._id,
          note: `NC import checkins ${p.sheet}`,
          isRefunded: false,
          locationId: new Types.ObjectId(p.locationId),
        });
        ctx.stats.paymentsCreated++;
        const added = await attachPackageNoSession({
          uid,
          pkgId: String(pkg._id),
          pkgName: pkg.name,
          remainingClasses: computeRemaining(pkg, 0),
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          locationId: p.locationId,
        });
        if (added) ctx.stats.packagesAdded++;
        else ctx.stats.skippedDuplicate++;
      }
    }
  }

  // Drop-in payment
  if (isDropIn && p.amount != null && p.amount > 0) {
    const methodInfo = mapPaymentMethod(p.methodRaw);
    const method: PaymentMethodEnum = methodInfo.method || "VISA";
    const purposeType =
      p.section === "open_gym" ? "WALKIN" : "DROPIN";
    if (ctx.dryRun) {
      ctx.stats.paymentsCreated++;
    } else {
      const { start, end } = cairoDayRange(p.sheetDate);
      const dup = await Payment.findOne({
        uid: new Types.ObjectId(uid),
        amount: p.amount,
        locationId: new Types.ObjectId(p.locationId),
        paymentTime: { $gte: start, $lt: end },
        purpose: purposeType,
        note: { $regex: /^NC import checkins/ },
      });
      if (!dup) {
        await Payment.create({
          uid: new Types.ObjectId(uid),
          amount: p.amount,
          paymentMethod: method,
          paymentTime: p.sheetDate,
          purpose: purposeType,
          note: `NC import checkins ${p.sheet}`,
          isRefunded: false,
          locationId: new Types.ObjectId(p.locationId),
        });
        ctx.stats.paymentsCreated++;
      } else {
        ctx.stats.skippedDuplicate++;
      }
    }
  }

  // Class attendance
  if (p.section === "class" && (isMemberOnly || isDropIn || mapEntry)) {
    const title = p.classTitle || "General Class";
    const cid = await findOrCreateImportClass(
      title,
      [ctx.hekmaId, ctx.matchaId],
      ctx.dryRun,
      ctx.classCache,
    );
    const startTime = classStartOnDate(p.sheetDate, p.classTime ?? null);
    const scid = await findOrCreateScheduledClass({
      cid,
      locationId: p.locationId,
      startTime,
      dryRun: ctx.dryRun,
      stats: ctx.stats,
      scCache: ctx.scCache,
    });
    await bookAndScan({
      scid,
      uid,
      method: isDropIn ? "Drop In" : "NC_IMPORT",
      dryRun: ctx.dryRun,
      stats: ctx.stats,
    });
  }

  // Open gym
  if (p.section === "open_gym") {
    await recordHistoricalOpenGym({
      date: p.sheetDate,
      uid,
      locationId: p.locationId,
      dryRun: ctx.dryRun,
      stats: ctx.stats,
    });
  }

  if (flags.length) {
    ctx.flagged.push({
      source: `${p.sheet}:${p.name}`,
      name: p.name,
      phone: ensured.phone,
      flags,
    });
  }
}

async function main() {
  const dryRun = !isApplyMode();
  console.log(
    `\n=== NC daily check-ins import (${dryRun ? "DRY-RUN" : "APPLY"}) ===\n`,
  );

  await connectDB();
  clearUserCache();
  const hekma = await resolveHekmaLocation();
  const matcha = await resolveMatchaLocation();
  console.log(`Hekma: ${hekma.branchName} (${hekma.id})`);
  console.log(`Matcha: ${matcha.branchName} (${matcha.id})`);

  const catalog = await loadPackageCatalog();
  const wb = readWorkbook(CHECKINS_XLSX);

  const stats = emptyStats();
  const flagged: FlaggedRow[] = [];
  const registry = loadGuestRegistry();
  const classCache: ClassCache = {
    byKey: new Map(),
    all: [],
    loaded: false,
  };
  const scCache = new Map<string, string>();
  const perSheet: Record<string, number> = {};
  const skippedSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const parsed = parseCheckinSheetName(sheetName);
    if (!parsed) {
      skippedSheets.push(sheetName);
      continue;
    }
    const locationId =
      parsed.locationKind === "Hekma" ? hekma.id : matcha.id;
    const rows = sheetToRows(wb, sheetName);
    const people = extractPeopleFromSheet(
      sheetName,
      rows,
      parsed.date,
      locationId,
      parsed.locationKind,
    );
    perSheet[sheetName] = people.length;
    console.log(
      `Sheet ${sheetName.padEnd(14)} ${parsed.date.toISOString().slice(0, 10)} ${parsed.locationKind} → ${people.length} people`,
    );

    for (const person of people) {
      await processPerson(person, {
        catalog,
        registry,
        dryRun,
        stats,
        flagged,
        classCache,
        scCache,
        hekmaId: hekma.id,
        matchaId: matcha.id,
      });
    }
  }

  if (!dryRun) saveGuestRegistry(registry);

  const reportPath = writeReport("import-nc-daily-checkins-report.json", {
    mode: dryRun ? "dry-run" : "apply",
    hekma,
    matcha,
    perSheet,
    skippedSheets,
    stats,
    flagged: flagged.slice(0, 500),
    flaggedTotal: flagged.length,
  });

  console.log("\n════════════════════════════════════════");
  console.log("Skipped sheets:", skippedSheets);
  console.log("Stats:", stats);
  console.log(`Flagged: ${flagged.length}`);
  console.log(`Report → ${reportPath}`);
  console.log("════════════════════════════════════════\n");
  console.log(
    "Run order: import-lavista-members.ts first, then this script.\n",
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
