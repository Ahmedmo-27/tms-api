/**
 * import-lavista-members.ts
 *
 * Imports La Vista Ras El Hekma members workbook into User + Member + Payment
 * + member packages (mapped onto existing Cairo catalog packages).
 *
 * Usage:
 *   npx ts-node src/scripts/import-lavista-members.ts --dry-run
 *   npx ts-node src/scripts/import-lavista-members.ts --apply
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import {
  MEMBERS_XLSX,
  PACKAGE_MAP,
  attachPackageNoSession,
  cellStr,
  computeRemaining,
  countVisitDates,
  emptyStats,
  ensureUserAndMember,
  clearUserCache,
  isApplyMode,
  loadGuestRegistry,
  loadPackageCatalog,
  mapPackageLabel,
  mapPaymentMethod,
  parseExcelDate,
  readWorkbook,
  resolveEndDate,
  resolveHekmaLocation,
  saveGuestRegistry,
  sheetToRows,
  writeReport,
  type FlaggedRow,
  type ImportStats,
  type PaymentMethodEnum,
} from "./import-nc-shared";
import Payment from "../models/payment";
import { Types } from "mongoose";
import { cairoDayRange } from "../utils/timezone";

interface ParsedMemberRow {
  sheet: "UMS" | "Classes" | "Space";
  rowIndex: number;
  name: string;
  rawPhone: unknown;
  packageRaw: string;
  amount: number | null;
  methodRaw: string;
  paymentDate: Date | null;
  visitCount: number;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseFloat(String(raw).replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseUmsRows(rows: unknown[][]): ParsedMemberRow[] {
  const out: ParsedMemberRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellStr(row[0]);
    if (!name) continue;
    // UMS quirk: col C = amount, col D = package name (headers swapped)
    const amount = parseAmount(row[2]);
    const packageRaw = cellStr(row[3]);
    const methodRaw = cellStr(row[4]);
    const paymentDate = parseExcelDate(row[5]);
    const visitCount = countVisitDates(row.slice(6));
    out.push({
      sheet: "UMS",
      rowIndex: i + 1,
      name,
      rawPhone: row[1],
      packageRaw,
      amount,
      methodRaw,
      paymentDate,
      visitCount,
    });
  }
  return out;
}

function parseClassesRows(rows: unknown[][]): ParsedMemberRow[] {
  const out: ParsedMemberRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellStr(row[0]);
    if (!name) continue;
    const classesRaw = cellStr(row[2]);
    const packageRaw = classesRaw
      ? /\d/.test(classesRaw)
        ? classesRaw.includes("class")
          ? classesRaw
          : `${classesRaw} classes`
        : classesRaw
      : "";
    out.push({
      sheet: "Classes",
      rowIndex: i + 1,
      name,
      rawPhone: row[1],
      packageRaw,
      amount: parseAmount(row[3]),
      methodRaw: cellStr(row[4]),
      paymentDate: parseExcelDate(row[5]),
      visitCount: countVisitDates(row.slice(6)),
    });
  }
  return out;
}

function parseSpaceRows(rows: unknown[][]): ParsedMemberRow[] {
  const out: ParsedMemberRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellStr(row[0]);
    if (!name) continue;
    // If package looks like a number (amount misplaced), treat col C as amount
    let packageRaw = cellStr(row[2]);
    let amount = parseAmount(row[3]);
    // Amount mistakenly placed in Package column (e.g. 2500 with blank/junk Payment)
    if (/^\d+(\.\d+)?$/.test(packageRaw)) {
      const pkgAsAmt = parseAmount(row[2]);
      if (
        amount == null ||
        (pkgAsAmt != null && pkgAsAmt >= 100 && amount < 100)
      ) {
        amount = pkgAsAmt;
      }
      packageRaw = cellStr(row[3]);
      if (!packageRaw || /^\d+(\.\d+)?$/.test(packageRaw)) {
        packageRaw = "";
      }
    }
    // Payment method wrongly in package column
    if (/^(instapay|visa|cash)$/i.test(packageRaw)) {
      packageRaw = "";
    }
    // Infer common Space packages from amount when label missing
    if (!packageRaw && amount != null) {
      if (amount === 2500) packageRaw = "1 Week Space";
      else if (amount === 3700) packageRaw = "2 Weeks Space";
      else if (amount === 6000 || amount === 2750) packageRaw = "1 Month Space";
      else if (amount === 8900) packageRaw = "whole summer space";
    }
    out.push({
      sheet: "Space",
      rowIndex: i + 1,
      name,
      rawPhone: row[1],
      packageRaw,
      amount,
      methodRaw: cellStr(row[4]),
      paymentDate: parseExcelDate(row[5]),
      visitCount: countVisitDates(row.slice(6)),
    });
  }
  return out;
}

async function importRow(
  row: ParsedMemberRow,
  ctx: {
    hekmaId: string;
    catalog: Awaited<ReturnType<typeof loadPackageCatalog>>;
    registry: ReturnType<typeof loadGuestRegistry>;
    dryRun: boolean;
    stats: ImportStats;
    flagged: FlaggedRow[];
  },
): Promise<void> {
  const flags: string[] = [];
  const source = `${row.sheet}:row${row.rowIndex}`;

  if (!row.packageRaw) {
    flags.push("MISSING_PACKAGE");
  }
  const mapEntry = row.packageRaw ? mapPackageLabel(row.packageRaw) : null;
  if (row.packageRaw && !mapEntry) {
    flags.push(`UNMAPPED_PACKAGE:${row.packageRaw}`);
  }

  let pkg = mapEntry ? ctx.catalog.get(mapEntry.catalogName) : undefined;
  if (mapEntry && !pkg) {
    // case-insensitive fallback
    for (const [name, p] of ctx.catalog) {
      if (name.toLowerCase() === mapEntry.catalogName.toLowerCase()) {
        pkg = p;
        break;
      }
    }
  }
  if (mapEntry && !pkg) {
    flags.push(`PACKAGE_NOT_IN_DB:${mapEntry.catalogName}`);
  }

  if (!row.paymentDate) flags.push("MISSING_PAYMENT_DATE");

  const methodInfo = mapPaymentMethod(row.methodRaw);
  if (methodInfo.flag) flags.push(methodInfo.flag);
  let method: PaymentMethodEnum = methodInfo.method || "VISA";
  if (!methodInfo.method && row.methodRaw) {
    // default visa for known NC cashless majority when method column polluted
    if (/ums|week|month|space|class/i.test(row.methodRaw)) {
      method = "VISA";
      flags.push(`ASSUMED_VISA_FROM_BAD_METHOD:${row.methodRaw}`);
    }
  }
  if (!row.methodRaw) {
    method = "VISA";
    flags.push("ASSUMED_VISA_MISSING_METHOD");
  }

  const amount =
    row.amount != null && row.amount > 0
      ? row.amount
      : pkg
        ? pkg.price
        : null;
  if (amount == null) flags.push("MISSING_AMOUNT");

  const blocking = flags.some(
    (f) =>
      f.startsWith("MISSING_PACKAGE") ||
      f.startsWith("UNMAPPED_PACKAGE") ||
      f.startsWith("PACKAGE_NOT_IN_DB") ||
      f.startsWith("MISSING_PAYMENT_DATE") ||
      f.startsWith("MISSING_AMOUNT"),
  );

  if (flags.length) {
    ctx.flagged.push({
      source,
      name: row.name,
      phone: cellStr(row.rawPhone),
      flags,
    });
  }

  if (blocking || !mapEntry || !pkg || !row.paymentDate || amount == null) {
    ctx.stats.skippedBlocking++;
    return;
  }

  const ensured = await ensureUserAndMember({
    name: row.name,
    rawPhone: row.rawPhone,
    locationId: ctx.hekmaId,
    registry: ctx.registry,
    dryRun: ctx.dryRun,
    stats: ctx.stats,
  });
  if (!ensured) {
    ctx.stats.skippedBlocking++;
    return;
  }
  if (ensured.isGuest) {
    flags.push("CREATED_AS_GUEST");
  }

  const remaining = computeRemaining(pkg, row.visitCount);
  const endDate = resolveEndDate(row.paymentDate, pkg, mapEntry);
  const startIso = row.paymentDate.toISOString();
  const { start, end } = cairoDayRange(row.paymentDate);

  // Duplicate package check
  if (!ctx.dryRun) {
    const Member = (await import("../models/member")).default;
    const existing = await Member.findOne({
      uid: ensured.user._id,
      packages: {
        $elemMatch: {
          pkgId: pkg._id,
          pkgStartDate: { $gte: start, $lt: end },
        },
      },
    });
    if (existing) {
      ctx.stats.skippedDuplicate++;
      return;
    }
  }

  const note = `NC import members ${row.sheet}`;

  if (ctx.dryRun) {
    ctx.stats.paymentsCreated++;
    ctx.stats.packagesAdded++;
    console.log(
      `[DRY] ${row.sheet.padEnd(7)} ${row.name.padEnd(24)} → ${pkg.name} | rem=${remaining} | ${amount} ${method}`,
    );
    return;
  }

  const payment = new Payment({
    uid: ensured.user._id,
    amount,
    paymentMethod: method,
    paymentTime: row.paymentDate,
    purpose: "PACKAGE",
    pkgId: pkg._id,
    note: methodInfo.noteExtra ? `${note} (${methodInfo.noteExtra})` : note,
    isRefunded: false,
    locationId: new Types.ObjectId(ctx.hekmaId),
  });
  await payment.save();
  ctx.stats.paymentsCreated++;

  const added = await attachPackageNoSession({
    uid: String(ensured.user._id),
    pkgId: String(pkg._id),
    pkgName: pkg.name,
    remainingClasses: remaining,
    startDate: startIso,
    endDate: endDate.toISOString(),
    locationId: ctx.hekmaId,
  });

  if (!added) {
    ctx.stats.skippedDuplicate++;
    return;
  }
  ctx.stats.packagesAdded++;
  console.log(
    `[OK]  ${row.sheet.padEnd(7)} ${row.name.padEnd(24)} → ${pkg.name} | rem=${remaining}`,
  );
}

async function main() {
  const dryRun = !isApplyMode();
  console.log(
    `\n=== La Vista Ras El Hekma members import (${dryRun ? "DRY-RUN" : "APPLY"}) ===\n`,
  );

  await connectDB();
  clearUserCache();

  const hekma = await resolveHekmaLocation();
  console.log(`Hekma location: ${hekma.branchName} (${hekma.id})`);

  const catalog = await loadPackageCatalog();
  console.log(`Package catalog size: ${catalog.size}`);

  // Preflight: required catalog names
  const required = new Set(
    Object.values(PACKAGE_MAP).map((e) => e.catalogName),
  );
  const missingCatalog: string[] = [];
  for (const name of required) {
    const found =
      catalog.has(name) ||
      [...catalog.keys()].some((k) => k.toLowerCase() === name.toLowerCase());
    if (!found) missingCatalog.push(name);
  }
  if (missingCatalog.length) {
    console.error("\nMissing Cairo packages in DB:");
    missingCatalog.forEach((n) => console.error(`  - ${n}`));
    console.error(
      "\nDry-run will still report per-row misses. Fix catalog before --apply.\n",
    );
  } else {
    console.log("All mapped Cairo package names found in DB.\n");
  }

  const wb = readWorkbook(MEMBERS_XLSX);
  const rows: ParsedMemberRow[] = [
    ...parseUmsRows(sheetToRows(wb, "UMS")),
    ...parseClassesRows(sheetToRows(wb, "Classes")),
    ...parseSpaceRows(sheetToRows(wb, "Space")),
  ];
  console.log(`Parsed ${rows.length} member rows\n`);

  const stats = emptyStats();
  const flagged: FlaggedRow[] = [];
  const registry = loadGuestRegistry();

  for (const row of rows) {
    await importRow(row, {
      hekmaId: hekma.id,
      catalog,
      registry,
      dryRun,
      stats,
      flagged,
    });
  }

  if (!dryRun) saveGuestRegistry(registry);

  const reportPath = writeReport("import-lavista-members-report.json", {
    mode: dryRun ? "dry-run" : "apply",
    hekma,
    missingCatalog,
    stats,
    flagged,
  });

  console.log("\n════════════════════════════════════════");
  console.log("Stats:", stats);
  console.log(`Flagged rows: ${flagged.length}`);
  console.log(`Report → ${reportPath}`);
  console.log("════════════════════════════════════════\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
