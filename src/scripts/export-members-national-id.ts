/**
 * Monthly Payments & User National ID Excel Exporter (Strictly Read-Only)
 *
 * Connects to MongoDB (prod.env by default, or dev.env with --dev) in strictly read-only mode,
 * queries package Payment records whose paymentTime falls within the requested Cairo-timezone month
 * (excluding paymentMethod "DEDUCTED" and drop-ins/walk-ins),
 * matches users by either `uid` or `nonMemberPhone` who have a valid National ID,
 * and exports a single clean table in an Excel spreadsheet (.xlsx).
 *
 * Usage:
 *   npm run export:members-national-id -- --year=2026 --month=10
 *   npm run export:members-national-id -- --dev --year=2026 --month=10
 *   npm run export:members-national-id -- --out="./reports/october_payments.xlsx"
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { formatInTimeZone } from "date-fns-tz";
import { CAIRO_TZ, cairoMonthRange } from "../utils/timezone";
import {
  buildPaymentsNationalIdExport,
  formatCairoDate,
} from "../services/payments-national-id-export";

export interface ExportMembersOptions {
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

export async function runExport(options: ExportMembersOptions = {}) {
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
  console.log(` 📋 MONTHLY PAYMENTS WITH USER NATIONAL ID [STRICT READ-ONLY]`);
  console.log(`================================================================================`);
  console.log(` Target Environment : ${envFile} (${isProd ? "PRODUCTION" : "DEVELOPMENT"})`);
  console.log(` Period             : Year ${year}, Month ${month} (${monthName})`);
  console.log(` Cairo Date Range   : ${formatCairoDate(startDate)} --> ${formatCairoDate(endDate)}`);
  console.log(`================================================================================\n`);

  await mongoose.connect(mongoUri, {
    readPreference: "secondaryPreferred",
  });

  try {
    const sheetName = `${monthName} ${year} Payments`.slice(0, 31);
    const { workbook, summary } = await buildPaymentsNationalIdExport({
      startDate,
      endDate,
      sheetName,
    });

    const timestampStr = formatInTimeZone(new Date(), CAIRO_TZ, "yyyyMMdd_HHmmss");
    const defaultFileName = `${monthName}_${year}_Payments_National_ID_${timestampStr}.xlsx`;
    const outputPath =
      options.outputPath || path.join(process.cwd(), defaultFileName);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    XLSX.writeFile(workbook, outputPath);

    console.log(` Total Payments in Range     : ${summary.totalPaymentsInRange}`);
    console.log(` Exported Rows (With NID)    : ${summary.exportedRowsCount}`);
    console.log(` Unique Users (With NID)     : ${summary.matchedUsersCount}`);
    console.log(` Total Exported Amount (EGP) : ${summary.totalExportedAmountEGP.toLocaleString()} EGP`);
    console.log(` Excel File Created At       : ${outputPath}\n`);

    return { outputPath, summary };
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
