/**
 * normalize-location-object-ids.ts
 *
 * Converts legacy string location ids to BSON ObjectIds across collections.
 * Root cause: processLocations previously stored valid id strings without casting.
 *
 * Usage:
 *   npx ts-node src/scripts/normalize-location-object-ids.ts --dry-run
 *   npx ts-node src/scripts/normalize-location-object-ids.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";

type FixReport = {
  collection: string;
  id: string;
  field: string;
  before: string;
  after: string;
};

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function isStringObjectId(value: unknown): value is string {
  return typeof value === "string" && Types.ObjectId.isValid(value);
}

async function normalizeClassLocations(
  db: mongoose.mongo.Db,
  dryRun: boolean,
  report: FixReport[],
): Promise<number> {
  const classes = await db.collection("classes").find({}).toArray();
  let fixed = 0;

  for (const cls of classes) {
    if (!Array.isArray(cls.locations) || cls.locations.length === 0) continue;

    let changed = false;
    const normalized = cls.locations.map((loc: unknown, index: number) => {
      if (loc instanceof Types.ObjectId) return loc;
      if (!isStringObjectId(loc)) return loc;

      changed = true;
      const objectId = new Types.ObjectId(loc);
      report.push({
        collection: "classes",
        id: cls._id.toString(),
        field: `locations[${index}]`,
        before: loc,
        after: objectId.toString(),
      });
      return objectId;
    });

    if (changed) {
      fixed += 1;
      if (!dryRun) {
        await db.collection("classes").updateOne(
          { _id: cls._id },
          { $set: { locations: normalized } },
        );
      }
    }
  }

  return fixed;
}

async function normalizeScalarLocationField(
  db: mongoose.mongo.Db,
  collectionName: string,
  field: string,
  dryRun: boolean,
  report: FixReport[],
): Promise<number> {
  const docs = await db
    .collection(collectionName)
    .find({ [field]: { $type: "string" } })
    .toArray();

  let fixed = 0;
  for (const doc of docs) {
    const raw = doc[field];
    if (!isStringObjectId(raw)) continue;

    const objectId = new Types.ObjectId(raw);
    fixed += 1;
    report.push({
      collection: collectionName,
      id: doc._id.toString(),
      field,
      before: raw,
      after: objectId.toString(),
    });

    if (!dryRun) {
      await db.collection(collectionName).updateOne(
        { _id: doc._id },
        { $set: { [field]: objectId } },
      );
    }
  }

  return fixed;
}

async function normalizeNestedAttendanceLocations(
  db: mongoose.mongo.Db,
  dryRun: boolean,
  report: FixReport[],
): Promise<number> {
  const docs = await db.collection("dailyattendances").find({}).toArray();
  let fixed = 0;

  for (const doc of docs) {
    let changed = false;
    const update: Record<string, unknown> = {};

    for (const key of ["ptAttendance", "openGymAttendance"] as const) {
      const entries = doc[key];
      if (!Array.isArray(entries)) continue;

      const normalized = entries.map((entry: any, index: number) => {
        const loc = entry?.locationId;
        if (!isStringObjectId(loc)) return entry;

        changed = true;
        const objectId = new Types.ObjectId(loc);
        report.push({
          collection: "dailyattendances",
          id: doc._id.toString(),
          field: `${key}[${index}].locationId`,
          before: loc,
          after: objectId.toString(),
        });
        return { ...entry, locationId: objectId };
      });

      if (changed) update[key] = normalized;
    }

    if (changed) {
      fixed += 1;
      if (!dryRun) {
        await db.collection("dailyattendances").updateOne(
          { _id: doc._id },
          { $set: update },
        );
      }
    }
  }

  return fixed;
}

async function main() {
  const dryRun = isDryRun();
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection not ready");

  console.log(`\n=== Normalize location ObjectIds ${dryRun ? "(DRY RUN)" : ""} ===\n`);

  const report: FixReport[] = [];
  const counts: Record<string, number> = {};

  counts.classes = await normalizeClassLocations(db, dryRun, report);
  counts.packages = await normalizeScalarLocationField(
    db,
    "packages",
    "locationId",
    dryRun,
    report,
  );
  counts.payments = await normalizeScalarLocationField(
    db,
    "payments",
    "locationId",
    dryRun,
    report,
  );
  counts.orders = await normalizeScalarLocationField(
    db,
    "orders",
    "locationId",
    dryRun,
    report,
  );
  counts.refunds = await normalizeScalarLocationField(
    db,
    "refunds",
    "locationId",
    dryRun,
    report,
  );
  counts.scheduledclasses = await normalizeScalarLocationField(
    db,
    "scheduledclasses",
    "locationId",
    dryRun,
    report,
  );
  counts.users = await normalizeScalarLocationField(
    db,
    "users",
    "locationId",
    dryRun,
    report,
  );
  counts.dailyattendances = await normalizeNestedAttendanceLocations(
    db,
    dryRun,
    report,
  );

  console.log("Documents updated by collection:");
  for (const [collection, count] of Object.entries(counts)) {
    console.log(`  ${collection}: ${count}`);
  }

  if (report.length === 0) {
    console.log("\nNo string location ids found.");
  } else {
    console.log(`\nField fixes (${report.length}):`);
    for (const item of report) {
      console.log(
        `  ${item.collection}/${item.id} ${item.field}: "${item.before}" -> ObjectId("${item.after}")`,
      );
    }
  }

  if (dryRun) {
    console.log("\nDry run only — re-run without --dry-run to apply.");
  } else {
    console.log("\nDone.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Normalization failed:", err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
