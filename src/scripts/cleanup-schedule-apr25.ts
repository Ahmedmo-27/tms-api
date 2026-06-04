/**
 * Deletes all ScheduledClass docs seeded for the week of Apr 25–May 1 (wrong dates)
 * and their associated Schedule docs, so we can re-seed with the correct Apr 26–May 2 dates.
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import ScheduledClass from "../models/scheduledClass";
import Schedule from "../models/schedule";

// The wrong date range: Apr 25 – May 1, 2026 (UTC midnight)
const WRONG_START = new Date("2026-04-25T00:00:00.000Z");
const WRONG_END   = new Date("2026-05-02T00:00:00.000Z"); // exclusive

async function main() {
  await connectDB();

  // 1. Find all ScheduledClass docs in the wrong date range
  const toDelete = await ScheduledClass.find({
    startTime: { $gte: WRONG_START, $lt: WRONG_END },
  }).select("_id");

  const ids = toDelete.map((d) => d._id);
  console.log(`Found ${ids.length} ScheduledClass docs to delete.`);

  if (ids.length === 0) {
    console.log("Nothing to delete.");
    await mongoose.disconnect();
    return;
  }

  // 2. Delete them
  const scResult = await ScheduledClass.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${scResult.deletedCount} ScheduledClass docs.`);

  // 3. Remove those IDs from Schedule docs (pull from classes array)
  const pullResult = await Schedule.updateMany(
    { classes: { $in: ids } },
    { $pull: { classes: { $in: ids } } }
  );
  console.log(`Updated ${pullResult.modifiedCount} Schedule docs (pulled class IDs).`);

  // 4. Delete any Schedule docs that are now empty
  const emptyResult = await Schedule.deleteMany({ classes: { $size: 0 } });
  console.log(`Deleted ${emptyResult.deletedCount} empty Schedule docs.`);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
