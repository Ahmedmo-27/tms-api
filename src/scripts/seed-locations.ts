/**
 * seed-locations.ts
 *
 * Seeds the Location collection.
 * Run from tms_api/: npx ts-node src/scripts/seed-locations.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Location from "../models/location";

const LOCATIONS = [
  {
    branchName: "The Mind Space",
    location: "New Cairo",
    locationUrl: "https://maps.app.goo.gl/qKnnCbgJUUS4ViGd6",
  },
  {
    branchName: "Matcha North Coast",
    location: "North Coast",
    locationUrl: "",
  },
];

async function main() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const loc of LOCATIONS) {
    const existing = await Location.findOne({ branchName: loc.branchName });
    if (existing) {
      console.log(`[SKIP]    ${loc.branchName}`);
      skipped++;
      continue;
    }
    await Location.create(loc);
    console.log(`[CREATED] ${loc.branchName} — ${loc.location}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
