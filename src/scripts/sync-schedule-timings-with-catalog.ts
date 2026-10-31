/**
 * sync-schedule-timings-with-catalog.ts
 *
 * Checks scheduled class durations against catalog class default durations,
 * reports mismatches, and updates scheduled class endTimes to match catalog timings.
 *
 * Usage:
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts              # Preview (dry run) from today onwards
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --apply      # Apply updates to database
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --all        # Check all classes (including past)
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --date=2026-11-01
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --class="Reformer"
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --env=dev
 *   npx ts-node src/scripts/sync-schedule-timings-with-catalog.ts --csv=report.csv
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose, { Types } from "mongoose";
import Class, { IClass } from "../models/class";
import ScheduledClass from "../models/scheduledClass";
import Location from "../models/location";
import Coach from "../models/coach";
import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";

// Ensure models are registered on mongoose connection
void Location;
void Coach;
void Class;
void ScheduledClass;

const CAIRO_TZ = "Africa/Cairo";

interface TimingComparisonRow {
  scid: string;
  cid: string;
  className: string;
  branch: string;
  coach: string;
  sessionDate: string;
  currentStart: string;
  currentEnd: string;
  currentDurationMins: number;
  catalogDurationMins: number;
  newEnd: string;
  hasMismatch: boolean;
  status: "MATCH" | "WOULD_UPDATE" | "UPDATED" | "ERROR" | "SKIPPED";
  details?: string;
}

function getCatalogDurationMinutes(cls: IClass | any): number {
  if (!cls) return 60;
  if (typeof cls.defaultDuration === "number" && cls.defaultDuration > 0) {
    return cls.defaultDuration;
  }
  const title = cls.title || "";
  return /reformer/i.test(title) ? 50 : 60;
}

async function run() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply") || args.includes("--update");
  const isAll = args.includes("--all");
  const envArg = args.find((a) => a.startsWith("--env="))?.split("=")[1] || "prod";
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
  const fromArg = args.find((a) => a.startsWith("--from="))?.split("=")[1];
  const classFilter = args.find((a) => a.startsWith("--class="))?.split("=")[1];
  const cidFilter = args.find((a) => a.startsWith("--cid="))?.split("=")[1];
  const csvArg = args.find((a) => a.startsWith("--csv="))?.split("=")[1];

  const envFile = envArg === "dev" ? "dev.env" : "prod.env";
  const envPath = path.resolve(process.cwd(), envFile);
  console.log(`[Sync Timings] Loading environment from ${envPath}...`);
  dotenv.config({ path: envPath });

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("[Sync Timings Error] MONGO_URI not found in environment.");
    process.exit(1);
  }

  console.log(`[Sync Timings] Mode: ${isApply ? ">>> APPLY CHANGES <<<" : "[DRY RUN] Preview Only (use --apply to execute updates)"}`);
  console.log(`[Sync Timings] Connecting to database...`);
  let connected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
      });
      connected = true;
      break;
    } catch (connErr) {
      console.warn(`[Sync Timings] Connection attempt ${attempt} failed: ${(connErr as Error).message}. Retrying...`);
      if (attempt === 3) throw connErr;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  if (!connected) return;
  console.log(`[Sync Timings] Connected successfully!\n`);

  // 1. Fetch all catalog classes and build a map
  const catalogClasses = await Class.find({}).lean();
  const catalogMap = new Map<string, any>();
  for (const c of catalogClasses) {
    catalogMap.set(c._id.toString(), c);
  }
  console.log(`[Catalog] Found ${catalogClasses.length} catalog class templates.`);
  for (const c of catalogClasses) {
    const dur = getCatalogDurationMinutes(c);
    const hasCustom = typeof c.defaultDuration === "number" && c.defaultDuration > 0;
    console.log(`  - ${c.title.padEnd(25)} | Category: ${(c.category || "N/A").padEnd(12)} | Duration: ${dur}m ${hasCustom ? "(custom defaultDuration)" : "(rule fallback)"}`);
  }
  console.log("");

  // 2. Build query for ScheduledClass
  const query: any = {};

  if (cidFilter) {
    query.cid = new Types.ObjectId(cidFilter);
  }

  if (dateArg) {
    const start = new Date(`${dateArg}T00:00:00.000Z`);
    const end = new Date(`${dateArg}T23:59:59.999Z`);
    query.startTime = { $gte: start, $lte: end };
  } else if (fromArg) {
    const start = new Date(`${fromArg}T00:00:00.000Z`);
    query.startTime = { $gte: start };
  } else if (!isAll) {
    // Default: From today in Cairo timezone onwards
    const todayCairoStr = formatInTimeZone(new Date(), CAIRO_TZ, "yyyy-MM-dd");
    const startOfToday = new Date(`${todayCairoStr}T00:00:00.000+02:00`);
    query.startTime = { $gte: startOfToday };
    console.log(`[Filter] Checking classes from today onwards (${todayCairoStr}). Use --all to include past sessions.`);
  } else {
    console.log(`[Filter] Checking ALL scheduled classes (all history).`);
  }

  // 3. Query scheduled classes with populated references
  const scheduledClasses = await ScheduledClass.find(query)
    .populate("cid")
    .populate("locationId", "branchName location")
    .populate("coachId", "coachName")
    .sort({ startTime: 1 })
    .lean();

  console.log(`[Schedule] Found ${scheduledClasses.length} scheduled class sessions matching criteria.\n`);

  const results: TimingComparisonRow[] = [];
  let mismatchCount = 0;
  let matchCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const s of scheduledClasses) {
    const scid = s._id.toString();
    const clsDoc = s.cid ? (typeof s.cid === "object" ? s.cid : catalogMap.get(String(s.cid))) : null;
    const className = (clsDoc as any)?.title || (s as any).className || "Unknown Class";

    // Filter by class name if specified
    if (classFilter && !className.toLowerCase().includes(classFilter.toLowerCase())) {
      continue;
    }

    const branch = (s.locationId as any)?.branchName || (s.locationId as any)?.location || (s as any).location || "N/A";
    const coaches = Array.isArray(s.coachId)
      ? s.coachId.map((c: any) => c?.coachName).filter(Boolean).join(", ")
      : (s.coachId as any)?.coachName || s.coachName || "N/A";

    const startTime = new Date(s.startTime);
    const endTime = new Date(s.endTime);

    const sessionDate = formatInTimeZone(startTime, CAIRO_TZ, "yyyy-MM-dd");
    const currentStartFormatted = formatInTimeZone(startTime, CAIRO_TZ, "hh:mm a");
    const currentEndFormatted = formatInTimeZone(endTime, CAIRO_TZ, "hh:mm a");

    const currentDurationMs = endTime.getTime() - startTime.getTime();
    const currentDurationMins = Math.round(currentDurationMs / (60 * 1000));

    const catalogDurationMins = getCatalogDurationMinutes(clsDoc);
    const targetEndMs = startTime.getTime() + catalogDurationMins * 60 * 1000;
    const newEndTime = new Date(targetEndMs);
    const newEndFormatted = formatInTimeZone(newEndTime, CAIRO_TZ, "hh:mm a");

    const hasMismatch = currentDurationMins !== catalogDurationMins;

    let status: TimingComparisonRow["status"] = "MATCH";
    let details = "";

    if (hasMismatch) {
      mismatchCount++;
      if (isApply) {
        try {
          await ScheduledClass.findByIdAndUpdate(scid, {
            endTime: newEndTime,
          });
          status = "UPDATED";
          updatedCount++;
          details = `Updated endTime from ${currentEndFormatted} to ${newEndFormatted}`;
        } catch (err: any) {
          status = "ERROR";
          errorCount++;
          details = `Error updating: ${err?.message}`;
        }
      } else {
        status = "WOULD_UPDATE";
        details = `Current ${currentDurationMins}m != Catalog ${catalogDurationMins}m (target: ${newEndFormatted})`;
      }
    } else {
      matchCount++;
      status = "MATCH";
      details = `Correct (${catalogDurationMins}m)`;
    }

    results.push({
      scid,
      cid: clsDoc?._id?.toString() || "",
      className,
      branch,
      coach: coaches,
      sessionDate,
      currentStart: currentStartFormatted,
      currentEnd: currentEndFormatted,
      currentDurationMins,
      catalogDurationMins,
      newEnd: newEndFormatted,
      hasMismatch,
      status,
      details,
    });
  }

  // 4. Print results table
  console.log("=".repeat(125));
  console.log(
    "Date".padEnd(12) +
    " | " + "Class".padEnd(20) +
    " | " + "Branch".padEnd(16) +
    " | " + "Current Time".padEnd(19) +
    " | " + "Cur Dur".padEnd(8) +
    " | " + "Cat Dur".padEnd(8) +
    " | " + "Target Time".padEnd(19) +
    " | " + "Status"
  );
  console.log("-".repeat(125));

  for (const r of results) {
    if (!r.hasMismatch && !isAll && results.length > 20) {
      // If there are many rows and user didn't specify --all, only show mismatches in the console
      continue;
    }
    const d = r.sessionDate.padEnd(12);
    const c = r.className.slice(0, 20).padEnd(20);
    const b = r.branch.slice(0, 16).padEnd(16);
    const curTime = `${r.currentStart} - ${r.currentEnd}`.padEnd(19);
    const curDur = `${r.currentDurationMins}m`.padEnd(8);
    const catDur = `${r.catalogDurationMins}m`.padEnd(8);
    const targetTime = `${r.currentStart} - ${r.newEnd}`.padEnd(19);
    const st = r.status.padEnd(12);

    console.log(`${d} | ${c} | ${b} | ${curTime} | ${curDur} | ${catDur} | ${targetTime} | ${st}`);
  }
  console.log("=".repeat(125));

  // 5. Summary
  console.log("\n[Summary]");
  console.log(`  Total Checked:     ${results.length}`);
  console.log(`  Matching:          ${matchCount}`);
  console.log(`  Mismatched:        ${mismatchCount}`);
  if (isApply) {
    console.log(`  Successfully Fixed: ${updatedCount}`);
    if (errorCount > 0) {
      console.log(`  Errors:             ${errorCount}`);
    }
  } else {
    console.log(`  Pending Updates:   ${mismatchCount} (Run with --apply to commit changes)`);
  }

  // 6. CSV export if requested
  if (csvArg) {
    const csvPath = path.resolve(process.cwd(), csvArg);
    console.log(`\n[CSV Export] Writing to ${csvPath}...`);
    const escapeCsv = (val: any) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "Scheduled Class ID",
      "Catalog Class ID",
      "Class Name",
      "Branch",
      "Coach",
      "Date",
      "Start Time",
      "Current End Time",
      "Current Duration (Mins)",
      "Catalog Duration (Mins)",
      "Target End Time",
      "Has Mismatch",
      "Status",
      "Details",
    ];
    const rows = results.map((r) => [
      escapeCsv(r.scid),
      escapeCsv(r.cid),
      escapeCsv(r.className),
      escapeCsv(r.branch),
      escapeCsv(r.coach),
      escapeCsv(r.sessionDate),
      escapeCsv(r.currentStart),
      escapeCsv(r.currentEnd),
      escapeCsv(r.currentDurationMins),
      escapeCsv(r.catalogDurationMins),
      escapeCsv(r.newEnd),
      escapeCsv(r.hasMismatch ? "YES" : "NO"),
      escapeCsv(r.status),
      escapeCsv(r.details),
    ]);
    const content = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    fs.writeFileSync(csvPath, content, "utf8");
    console.log(`[CSV Export] Successfully written ${results.length} rows.`);
  }

  await mongoose.disconnect();
  console.log("\n[Sync Timings] Database disconnected cleanly.");
}

run().catch((err) => {
  console.error("[Sync Timings Fatal Error]:", err);
  process.exit(1);
});
