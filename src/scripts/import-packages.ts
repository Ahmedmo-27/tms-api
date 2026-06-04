/**
 * import-packages.ts
 *
 * One-time recovery script: reads the member packages CSV and inserts
 * NonUserPackage documents into MongoDB.
 *
 * Run from tms_api/: npx ts-node src/scripts/import-packages.ts
 *
 * Handles programmatically:
 *   - Phone normalization (10-digit → prepend 0)
 *   - Package name shorthand mapping
 *   - Date typos (double slashes, missing slash like 11/112025)
 *   - Year inference (start > end → decrement start year; end < start → increment end year)
 *   - remainingClasses = packageSessions - attendedCount (capped at 0)
 *   - Blank attendedCount → count non-empty attendance cells as fallback
 *   - ULTIMATE packages → remainingClasses = 10000
 *   - Duplicate check (same phone + package + start date)
 *
 * Flags but does not skip (warning-only):
 *   - Rows with reformer/galentine notes in attendance cells (double-deduction may be off)
 *   - Rows with freeze / future-start notes
 *   - attendedCount > packageSessions (over-attended, capped to 0)
 *
 * Flags AND skips (blocking):
 *   - Missing or invalid phone number
 *   - Unknown package name
 *   - Missing or unparseable start/end date
 *   - Excel serial number in date fields
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import fs from "fs";
import mongoose from "mongoose";
import connectDB from "../config/db";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";

// ── Package name mapping ──────────────────────────────────────────────────────

const PKG_NAME_MAP: Record<string, string> = {
  "6 prenatal":                         "6 Prenatal",
  "8 prenatal":                         "8 Prenatal",
  "10 prenatal":                        "10 Prenatal",
  "5 st":                               "5 Studio",
  "10 st":                              "10 Studio",
  "15 st":                              "15 Studio",
  "10 ft":                              "10 Functional Training",
  "20 ft":                              "20 Functional Training",
  "30 ft":                              "30 Functional Training",
  "50 ft":                              "50 Functional Training",
  "10 functional training":             "10 Functional Training",
  "20 functional training":             "20 Functional Training",
  "30 functional training":             "30 Functional Training",
  "50 functional training":             "50 Functional Training",
  "1 month ultimate":                   "1 Month Ultimate Mindspacer",
  "3 month ultimate":                   "3 Month Ultimate Mindspacer",
  "6 month ultimate":                   "6 Month Ultimate Mindspacer",
  "12 month ultimate":                  "12 Month Ultimate Mindspacer",
  "st/ft":                              "Spacer Mix (Functional Training + Studio)",
  "ft/st":                              "Spacer Mix (Functional Training + Studio)",
  "st/space":                           "Spacer Mix (Studio + Space)",
  "space/st":                           "Spacer Mix (Studio + Space)",
  "ft/space":                           "Spacer Mix (Functional Training + Space)",
  "space/ft":                           "Spacer Mix (Functional Training + Space)",
};

function mapPkgName(raw: string): string | null {
  return PKG_NAME_MAP[raw.toLowerCase().trim()] ?? null;
}

// ── Session counts (mirrors the seed) ────────────────────────────────────────

const PKG_SESSIONS: Record<string, number> = {
  "6 Prenatal":                               6,
  "8 Prenatal":                               8,
  "10 Prenatal":                              10,
  "5 Studio":                                 5,
  "10 Studio":                                10,
  "15 Studio":                                15,
  "10 Functional Training":                   10,
  "20 Functional Training":                   20,
  "30 Functional Training":                   30,
  "50 Functional Training":                   50,
  "1 Month Ultimate Mindspacer":              10000,
  "3 Month Ultimate Mindspacer":              10000,
  "6 Month Ultimate Mindspacer":              10000,
  "12 Month Ultimate Mindspacer":             10000,
  "Spacer Mix (Studio + Space)":              6,
  "Spacer Mix (Functional Training + Space)": 10,
  "Spacer Mix (Functional Training + Studio)":10,
};

// ── Phone normalization ───────────────────────────────────────────────────────

function normalizePhone(raw: string): { phone: string | null; flag: string | null } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0)                              return { phone: null, flag: "MISSING_PHONE" };
  if (digits.length === 10)                             return { phone: "0" + digits, flag: null };
  if (digits.length === 11 && digits.startsWith("0"))   return { phone: digits, flag: null };
  return { phone: null, flag: `INVALID_PHONE:${raw}` };
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string): { date: Date | null; flag: string | null; yearExplicit: boolean } {
  const s = raw.trim();
  if (!s) return { date: null, flag: "MISSING_DATE", yearExplicit: false };

  // Fix double slash (14//3 → 14/3)
  let fixed = s.replace("//", "/");

  // Fix missing slash: 11/112025 → 11/11/2025
  fixed = fixed.replace(/^(\d{1,2})\/(\d{2})(\d{4})$/, "$1/$2/$3");

  // Excel serial: a standalone 5-digit number (possibly formatted as "46,144")
  const noComma = fixed.replace(",", "");
  if (/^\d{5}$/.test(noComma)) {
    return { date: null, flag: `EXCEL_SERIAL:${s}`, yearExplicit: false };
  }

  const m = fixed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return { date: null, flag: `UNPARSEABLE_DATE:${s}`, yearExplicit: false };

  const day   = parseInt(m[1]);
  const month = parseInt(m[2]);
  const year  = m[3] ? parseInt(m[3]) : 2026;

  const d = new Date(year, month - 1, day, 12, 0, 0);
  // Validate: JS wraps invalid dates, so check the month didn't shift
  if (isNaN(d.getTime()) || d.getMonth() !== month - 1) {
    return { date: null, flag: `INVALID_DATE:${s}`, yearExplicit: false };
  }
  return { date: d, flag: null, yearExplicit: !!m[3] };
}

// ── Attendance helpers ────────────────────────────────────────────────────────

const REFORMER_RE = /reformer|galentine/i;
const FREEZE_RE   = /freez|freeze|starting date/i;

function countAttendanceDates(cells: string[]): { count: number; hasReformerNotes: boolean } {
  let count = 0;
  let hasReformerNotes = false;
  for (const cell of cells) {
    const c = cell.trim();
    if (!c) continue;
    if (REFORMER_RE.test(c)) hasReformerNotes = true;
    count++;
  }
  return { count, hasReformerNotes };
}

// ── CSV line parser (handles quoted fields with commas) ───────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Section detection ─────────────────────────────────────────────────────────

const SECTION_HEADERS = new Set(["PRE/POST", "STUDIO", "FUNCTIONAL", "SPACER MIX", "ULTIMATE"]);

function isSectionHeader(cols: string[]): boolean {
  return SECTION_HEADERS.has(cols[0]) && cols.slice(1).every(c => !c);
}

function isBlankRow(cols: string[]): boolean {
  return cols.every(c => !c);
}

// ── Report type ───────────────────────────────────────────────────────────────

interface FlaggedRow {
  rowNum: number;
  section: string;
  name: string;
  phone: string;
  pkg: string;
  flags: string[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  // Build package name → DB doc map
  const allPackages = await Package.find({});
  const pkgByName = new Map(allPackages.map(p => [p.name, p]));

  const csvPath = path.join(__dirname, "../../../recovery/Members packages - Sheet1.csv");
  const lines = fs.readFileSync(csvPath, "utf-8").split("\n");

  let section = "UNKNOWN";
  let imported = 0;
  let skippedBlocking = 0;
  let skippedDuplicate = 0;
  const flagged: FlaggedRow[] = [];

  // Row 0 is the header — start at 1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const cols = parseCSVLine(line);

    if (isBlankRow(cols)) continue;
    if (isSectionHeader(cols)) { section = cols[0]; continue; }

    const rowNum = i + 1;
    const name     = cols[1]?.trim() || "";
    const rawPhone = cols[2]?.trim() || "";
    const rawPkg   = cols[3]?.trim() || "";
    const rawStart = cols[4]?.trim() || "";
    const rawEnd   = cols[5]?.trim() || "";
    const rawCount = cols[6]?.trim() || "";
    const attendanceCells = cols.slice(7);

    const rowFlags: string[] = [];

    // ── Phone ────────────────────────────────────────────────────────────────
    const { phone, flag: phoneFlag } = normalizePhone(rawPhone);
    if (phoneFlag) rowFlags.push(phoneFlag);

    // ── Package name ─────────────────────────────────────────────────────────
    const mappedPkg = mapPkgName(rawPkg);
    if (!mappedPkg) rowFlags.push(`UNKNOWN_PKG:${rawPkg}`);

    // ── Dates ────────────────────────────────────────────────────────────────
    const { date: startDateRaw, flag: startFlag, yearExplicit: startYearExplicit } = parseDate(rawStart);
    const { date: endDateRaw,   flag: endFlag,   yearExplicit: endYearExplicit   } = parseDate(rawEnd);

    if (startFlag) rowFlags.push(`START_${startFlag}`);
    if (endFlag)   rowFlags.push(`END_${endFlag}`);

    // Fix year assumptions: if start > end and year was assumed, decrement start year
    let startDate = startDateRaw;
    let endDate   = endDateRaw;
    if (startDate && endDate) {
      if (!startYearExplicit && startDate > endDate) {
        startDate = new Date(startDate.getFullYear() - 1, startDate.getMonth(), startDate.getDate(), 12);
      }
      if (!endYearExplicit && endDate < startDate) {
        endDate = new Date(endDate.getFullYear() + 1, endDate.getMonth(), endDate.getDate(), 12);
      }
    }

    // ── Name sanity ──────────────────────────────────────────────────────────
    if (!name) rowFlags.push("MISSING_NAME");
    else if (/^\d+$/.test(name)) rowFlags.push(`INVALID_NAME_IS_NUMBER:${name}`);

    // ── Attendance ───────────────────────────────────────────────────────────
    const parsedCount = parseInt(rawCount);
    const { count: dateCount, hasReformerNotes } = countAttendanceDates(attendanceCells);
    const attendedCount = !isNaN(parsedCount) ? parsedCount : dateCount;

    if (hasReformerNotes) {
      rowFlags.push("HAS_REFORMER_NOTES — double-deduction may be off, verify manually");
    }

    const attendanceText = attendanceCells.filter(c => c.trim()).join(" | ");
    if (FREEZE_RE.test(attendanceText)) {
      rowFlags.push(`FREEZE_OR_FUTURE_START_NOTE: ${attendanceText}`);
    }

    // ── Remaining classes ─────────────────────────────────────────────────────
    let remainingClasses = 0;
    if (mappedPkg) {
      const total = PKG_SESSIONS[mappedPkg];
      if (total === 10000) {
        remainingClasses = 10000;
      } else {
        if (attendedCount > total) {
          rowFlags.push(`OVER_ATTENDED:${attendedCount}/${total} — capped to 0 remaining`);
        }
        remainingClasses = Math.max(0, total - attendedCount);
      }
    }

    // ── Blocking check ───────────────────────────────────────────────────────
    const blockingFlags = rowFlags.filter(f =>
      f.startsWith("MISSING_PHONE") ||
      f.startsWith("INVALID_PHONE") ||
      f.startsWith("UNKNOWN_PKG") ||
      f.startsWith("MISSING_NAME") ||
      f.startsWith("INVALID_NAME") ||
      f.includes("MISSING_DATE") ||
      f.includes("EXCEL_SERIAL") ||
      f.includes("UNPARSEABLE_DATE") ||
      f.includes("INVALID_DATE")
    );

    if (rowFlags.length > 0) {
      flagged.push({ rowNum, section, name, phone: rawPhone, pkg: rawPkg, flags: rowFlags });
    }

    if (blockingFlags.length > 0) {
      skippedBlocking++;
      continue;
    }

    // ── DB package lookup ─────────────────────────────────────────────────────
    const pkg = pkgByName.get(mappedPkg!);
    if (!pkg) {
      flagged.push({ rowNum, section, name, phone: rawPhone, pkg: rawPkg, flags: [`PACKAGE_NOT_IN_DB:${mappedPkg}`] });
      skippedBlocking++;
      continue;
    }

    // ── Duplicate check ───────────────────────────────────────────────────────
    const existing = await NonUserPackage.findOne({
      phoneNumber: phone,
      pkgId: pkg._id,
      pkgStartDate: startDate,
    });
    if (existing) {
      skippedDuplicate++;
      continue;
    }

    // ── Insert ────────────────────────────────────────────────────────────────
    await NonUserPackage.create({
      name,
      phoneNumber: phone,
      pkgId: pkg._id,
      pkgStartDate: startDate,
      pkgEndDate: endDate,
      remainingClasses,
      added: false,
    });

    imported++;
    console.log(`[OK]  ${String(imported).padStart(3)}  ${name.padEnd(30)} | ${phone} | ${mappedPkg} | rem: ${remainingClasses}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  DONE: ${imported} imported  |  ${skippedBlocking} skipped (blocking)  |  ${skippedDuplicate} skipped (duplicate)`);
  console.log("══════════════════════════════════════════════════════════════════\n");

  if (flagged.length > 0) {
    console.log(`FLAGGED (${flagged.length} rows — includes warnings on imported rows):\n`);
    for (const f of flagged) {
      console.log(`  Row ${String(f.rowNum).padEnd(4)} [${f.section.padEnd(10)}] ${(f.name || "(no name)").padEnd(30)} | phone: ${f.phone} | pkg: ${f.pkg}`);
      for (const fl of f.flags) {
        console.log(`    ⚠  ${fl}`);
      }
    }
  }

  // Write JSON report
  const reportPath = path.join(__dirname, "../../../recovery/import-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ imported, skippedBlocking, skippedDuplicate, flagged }, null, 2));
  console.log(`\nFull report → recovery/import-report.json`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
