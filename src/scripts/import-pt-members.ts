/**
 * import-pt-members.ts
 *
 * Reads the PT member CSV from P1915 onwards and inserts NonUserPackage
 * documents — identical pattern to import-packages.ts.
 *
 * Blocking skips:  missing/invalid phone, unparseable session count or
 *                  start date, unknown trainer, package not in DB.
 * Duplicate check: same phoneNumber + pkgId + pkgStartDate.
 *
 * Run from tms_api/: npx ts-node src/scripts/import-pt-members.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import fs from "fs";
import mongoose from "mongoose";
import connectDB from "../config/db";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";

// ─── Trainer name → DB coachName ─────────────────────────────────────────────

const TRAINER_MAP: Record<string, string> = {
  "salma":                               "Salma Ghazzawi",
  "salma ghazzawi":                      "Salma Ghazzawi",
  "salma (switched to hana)":            "Salma Ghazzawi",
  "shoukry":                             "Shoukry",
  "hana":                                "Hana Abaza",
  "hana abaza":                          "Hana Abaza",
  "hana abaza (until she finishes)":     "Hana Abaza",
  "hana minisy":                         "Hana Elmeneisy",
  "hana minissy":                        "Hana Elmeneisy",
  "dana":                                "Dana",
  "nour":                                "Nour Rashad",
  "nour rashad":                         "Nour Rashad",
  "nour rashsad":                        "Nour Rashad",
  "nour (switch to lujain)":             "Nour Rashad",
  "nour (switched to shaarawy 7/7)":     "Nour Rashad",
  "asser":                               "Asser",
  "assser":                              "Asser",
  "moura":                               "Moura",
  "youssef":                             "Youssef Khaled",
  "yousssef":                            "Youssef Khaled",
  "switched to youssef on 7/12":         "Youssef Khaled",
  "zeina transferred to youssef":        "Youssef Khaled",
  "haidy":                               "Haidy",
  "zeina":                               "Zeina Zidan",
  "zeina zidan":                         "Zeina Zidan",
  "zeina (switched to asser)":           "Zeina Zidan",
  "zeina (switched to hana)":            "Zeina Zidan",
  "zeina tarek":                         "Zeina Tarek",
  "lujain":                              "Lujain",
  "lujine":                              "Lujain",
  "lujaine":                             "Lujain",
  "omar":                                "Omar ElAlamy",
  "omar el alamy":                       "Omar ElAlamy",
  "omar elalamy":                        "Omar ElAlamy",
  "omar elalmy":                         "Omar ElAlamy",
  "omar alamy":                          "Omar ElAlamy",
  "alamy":                               "Omar ElAlamy",
  "omar sharawy":                        "Omar ElAlamy",
  "omar shaarawy":                       "Omar ElAlamy",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function normalizePhone(raw: string): { phone: string | null; flag: string | null } {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0)                            return { phone: null, flag: "MISSING_PHONE" };
  if (digits.length === 10)                           return { phone: "0" + digits, flag: null };
  if (digits.length === 11 && digits.startsWith("0")) return { phone: digits, flag: null };
  return { phone: null, flag: `INVALID_PHONE:${raw}` };
}

function parseDate(raw: string): { date: Date | null; flag: string | null; yearExplicit: boolean } {
  const s = raw.trim();
  if (!s) return { date: null, flag: "MISSING_DATE", yearExplicit: false };
  let fixed = s.replace("//", "/");
  fixed = fixed.replace(/^(\d{1,2})\/(\d{2})(\d{4})$/, "$1/$2/$3");
  const noComma = fixed.replace(",", "");
  if (/^\d{5}$/.test(noComma)) return { date: null, flag: `EXCEL_SERIAL:${s}`, yearExplicit: false };
  const m = fixed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return { date: null, flag: `UNPARSEABLE_DATE:${s}`, yearExplicit: false };
  const day = parseInt(m[1]), month = parseInt(m[2]), year = m[3] ? parseInt(m[3]) : 2026;
  const d = new Date(year, month - 1, day, 12, 0, 0);
  if (isNaN(d.getTime()) || d.getMonth() !== month - 1)
    return { date: null, flag: `INVALID_DATE:${s}`, yearExplicit: false };
  return { date: d, flag: null, yearExplicit: !!m[3] };
}

function parseSessions(val: string): number | null {
  const n = parseInt(val.replace(/\D/g, ""), 10);
  return isNaN(n) ? null : n;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface FlaggedRow { rowId: string; name: string; phone: string; flags: string[] }

async function main() {
  await connectDB();

  // Build package lookup: "10 Personal Training with Salma Ghazzawi" → doc
  const allPtPkgs = await Package.find({ category: "PERSONAL_TRAINING" });
  const pkgByName = new Map(allPtPkgs.map(p => [p.name, p]));

  const csvPath = path.join(__dirname, "../../../recovery/The Mind Space Members - P.T.csv");
  const lines = fs.readFileSync(csvPath, "utf-8").split("\n").map(l => l.replace(/\r$/, ""));

  const startIdx = lines.findIndex(l => parseCSVLine(l)[0].trim() === "P1691");
  if (startIdx === -1) throw new Error("P1691 not found in CSV");

  const dataLines = lines.slice(startIdx).filter(l => /^P\d+,/.test(l.trim()));
  console.log(`Processing ${dataLines.length} rows from P1691 onwards...\n`);

  let imported = 0, skippedBlocking = 0, skippedDuplicate = 0;
  const flagged: FlaggedRow[] = [];

  for (const line of dataLines) {
    const cols    = parseCSVLine(line);
    const rowId   = cols[0]?.trim();
    const name    = cols[1]?.trim() || "";
    const rawPhone = cols[2]?.trim() || "";
    const trainer  = cols[3]?.trim().toLowerCase();
    const rawStart = cols[10]?.trim() || "";
    const rawEnd   = cols[11]?.trim() || "";
    const attendanceCells = cols.slice(12);

    const rowFlags: string[] = [];

    // Phone
    const { phone, flag: phoneFlag } = normalizePhone(rawPhone);
    if (phoneFlag) rowFlags.push(phoneFlag);

    // Name
    if (!name) rowFlags.push("MISSING_NAME");

    // Trainer → package name prefix
    const coachName = TRAINER_MAP[trainer];
    if (!coachName) rowFlags.push(`UNKNOWN_TRAINER:${cols[3]?.trim()}`);

    // Session count — pick first filled column among 24/20/12/10
    let totalSessions: number | null = null;
    for (const col of [4, 5, 6, 7]) {
      const v = parseSessions(cols[col] ?? "");
      if (v !== null) { totalSessions = v; break; }
    }
    if (!totalSessions) rowFlags.push("MISSING_SESSION_COUNT");

    // Dates
    const { date: startDateRaw, flag: startFlag, yearExplicit: startYearExplicit } = parseDate(rawStart);
    const { date: endDateRaw,   flag: endFlag,   yearExplicit: endYearExplicit   } = parseDate(rawEnd);
    if (startFlag) rowFlags.push(`START_${startFlag}`);

    let startDate = startDateRaw;
    let endDate   = endDateRaw;
    if (startDate && endDate) {
      if (!startYearExplicit && startDate > endDate)
        startDate = new Date(startDate.getFullYear() - 1, startDate.getMonth(), startDate.getDate(), 12);
      if (!endYearExplicit && endDate < startDate)
        endDate = new Date(endDate.getFullYear() + 1, endDate.getMonth(), endDate.getDate(), 12);
    }

    // Used / remaining sessions
    const usedSessions = attendanceCells.filter(c => c.trim()).length;
    const remainingClasses = totalSessions ? Math.max(0, totalSessions - usedSessions) : 0;
    if (totalSessions && usedSessions > totalSessions)
      rowFlags.push(`OVER_ATTENDED:${usedSessions}/${totalSessions} — capped to 0 remaining`);

    if (rowFlags.length) flagged.push({ rowId, name, phone: rawPhone, flags: rowFlags });

    // Blocking check
    const blocking = rowFlags.some(f =>
      f.startsWith("MISSING_PHONE") || f.startsWith("INVALID_PHONE") ||
      f.startsWith("MISSING_NAME")  || f.startsWith("UNKNOWN_TRAINER") ||
      f.startsWith("MISSING_SESSION") ||
      f.includes("MISSING_DATE") || f.includes("EXCEL_SERIAL") ||
      f.includes("UNPARSEABLE_DATE") || f.includes("INVALID_DATE")
    );
    if (blocking) { skippedBlocking++; continue; }

    // Package lookup
    const pkgName = `${totalSessions} Personal Training with ${coachName}`;
    const pkg = pkgByName.get(pkgName);
    if (!pkg) {
      flagged.push({ rowId, name, phone: rawPhone, flags: [`PACKAGE_NOT_IN_DB:${pkgName}`] });
      skippedBlocking++;
      continue;
    }

    // End date fallback: start + package expiryPeriod
    const pkgEndDate = endDate ?? new Date(startDate!.getTime() + pkg.expiryPeriod * 86400000);

    // Duplicate check
    const existing = await NonUserPackage.findOne({ phoneNumber: phone, pkgId: pkg._id, pkgStartDate: startDate });
    if (existing) { skippedDuplicate++; continue; }

    // Insert
    await NonUserPackage.create({
      name,
      phoneNumber: phone,
      pkgId:            pkg._id,
      pkgStartDate:     startDate,
      pkgEndDate,
      remainingClasses,
      added: false,
    });

    imported++;
    console.log(`[OK] ${String(imported).padStart(3)}  ${name.padEnd(28)} | ${phone} | ${pkgName} | rem: ${remainingClasses}`);
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  DONE: ${imported} imported  |  ${skippedBlocking} skipped (blocking)  |  ${skippedDuplicate} skipped (duplicate)`);
  console.log("══════════════════════════════════════════════════════════════════\n");

  if (flagged.length > 0) {
    console.log(`FLAGGED (${flagged.length} rows):\n`);
    for (const f of flagged) {
      console.log(`  ${f.rowId.padEnd(6)} ${(f.name || "(no name)").padEnd(28)} | phone: ${f.phone}`);
      for (const fl of f.flags) console.log(`    ⚠  ${fl}`);
    }
  }

  const reportPath = path.join(__dirname, "../../../recovery/import-pt-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ imported, skippedBlocking, skippedDuplicate, flagged }, null, 2));
  console.log(`\nFull report → recovery/import-pt-report.json`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
