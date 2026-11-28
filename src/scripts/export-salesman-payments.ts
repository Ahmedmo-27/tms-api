/**
 * Monthly Package Payments & Salesman Attribution Excel Exporter (Strictly Read-Only)
 *
 * Connects to MongoDB (prod.env by default, or dev.env with --dev) in strictly read-only mode,
 * queries package Payment records whose paymentTime falls within the requested Cairo-timezone month
 * (excluding paymentMethod "DEDUCTED" and drop-ins/walk-ins),
 * does NOT require a National ID (includes all package payments, including non-member payments),
 * resolves the responsible Salesman from Member.packages[].soldBy (with member-level fallback),
 * and exports a single clean table in an Excel spreadsheet (.xlsx).
 *
 * Usage:
 *   npm run export:salesman-payments -- --year=2026 --month=10
 *   npm run export:salesman-payments -- --dev --year=2026 --month=10
 *   npm run export:salesman-payments -- --out="./reports/october_salesman_payments.xlsx"
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { formatInTimeZone } from "date-fns-tz";
import { CAIRO_TZ, cairoMonthRange } from "../utils/timezone";
import { formatCairoDate } from "../services/payments-national-id-export";
import { buildSalesmanPaymentsExport } from "../services/salesman-payments-export";

export interface ExportSalesmanPaymentsOptions {
  year?: number;
  month?: number;
  isProd?: boolean;
  envFile?: string;
  outputPath?: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export async function runExport(options: ExportSalesmanPaymentsOptions = {}) {
  const isProd =
    options.isProd !== undefined
      ? options.isProd
      : !process.argv.includes("--dev");
  const defaultEnvFile = isProd ? "prod.env" : "dev.env";
  const envFile = options.envFile || defaultEnvFile;

  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error(`MONGO_URI is missing in ${envFile}!`);
  }

  const now = new Date();
  const year =
    options.year ||
    parseInt(process.env.EXPORT_YEAR || "", 10) ||
    now.getFullYear();
  const month =
    options.month ||
    parseInt(process.env.EXPORT_MONTH || "", 10) ||
    now.getMonth() + 1;

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month "${month}". Must be an integer between 1 and 12.`);
  }

  const monthName = MONTH_NAMES[month - 1];
  const { start: startDate, end: endDate } = cairoMonthRange(year, month);

  console.log(`\n================================================================================`);
  console.log(` 📋 MONTHLY PACKAGE PAYMENTS BY SALESMAN [STRICT READ-ONLY]`);
  console.log(`================================================================================`);
  console.log(` Target Environment : ${envFile} (${isProd ? "PRODUCTION" : "DEVELOPMENT"})`);
  console.log(` Period             : Year ${year}, Month ${month} (${monthName})`);
  console.log(` Cairo Date Range   : ${formatCairoDate(startDate)} --> ${formatCairoDate(endDate)}`);
  console.log(`================================================================================\n`);

  await mongoose.connect(mongoUri, {
    readPreference: "secondaryPreferred",
  });

  try {
    const sheetName = `${monthName} ${year} Salesman`.slice(0, 31);
    const { workbook, summary } = await buildSalesmanPaymentsExport({
      startDate,
      endDate,
      sheetName,
    });

    const timestampStr = formatInTimeZone(new Date(), CAIRO_TZ, "yyyyMMdd_HHmmss");
    const defaultFileName = `${monthName}_${year}_Salesman_Payments_${timestampStr}.xlsx`;
    const outputPath =
      options.outputPath || path.join(process.cwd(), defaultFileName);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    XLSX.writeFile(workbook, outputPath);

    console.log(` Total Package Payments      : ${summary.totalPayments}`);
    console.log(` Total Exported Amount (EGP) : ${summary.totalExportedAmountEGP.toLocaleString()} EGP`);
    console.log(` Breakdown by Salesman       :`);
    for (const [name, stat] of Array.from(summary.salesmanTotals.entries()).sort(
      (a, b) => b[1].amount - a[1].amount
    )) {
      console.log(
        `   - ${name.padEnd(25)} : ${String(stat.count).padStart(4)} sales | ${stat.amount.toLocaleString()} EGP`
      );
    }
    console.log(` Excel File Created At       : ${outputPath}\n`);

    return {
      outputPath,
      totalRows: summary.totalPayments,
      totalExportedAmountEGP: summary.totalExportedAmountEGP,
    };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let yearArg: number | undefined;
  let monthArg: number | undefined;
  let outArg: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--year=")) {
      yearArg = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--month=")) {
      monthArg = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--out=")) {
      outArg = arg.split("=")[1];
    }
  }

  runExport({
    year: yearArg,
    month: monthArg,
    outputPath: outArg,
  }).catch((err) => {
    console.error("\n❌ Error during export:", err);
    process.exit(1);
  });
}
