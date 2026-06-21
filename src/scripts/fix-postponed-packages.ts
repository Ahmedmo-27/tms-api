/**
 * fix-postponed-packages.ts
 *
 * Finds all member packages incorrectly set to POSTPONED whose start date
 * is today or in the past (Egypt/Cairo timezone) and resets them to ACTIVE.
 *
 * Run from tms_api/: npx ts-node src/scripts/fix-postponed-packages.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Member from "../models/member";
import { startOfTodayCairo } from "../utils/timezone";

async function main() {
  await connectDB();

  const todayCairo = startOfTodayCairo();
  console.log(`[INFO] Cairo 'today' start: ${todayCairo.toISOString()}`);

  const members = await Member.find({
    "packages.status": "POSTPONED",
  });

  console.log(`[INFO] Found ${members.length} member(s) with at least one POSTPONED package.`);

  let totalFixed = 0;
  let totalSkipped = 0;

  for (const member of members) {
    let changed = false;

    for (const pkg of member.packages) {
      if (pkg.status !== "POSTPONED") continue;

      const pkgStart = new Date(pkg.pkgStartDate);
      const pkgEnd = new Date(pkg.pkgEndDate);
      const now = new Date();

      if (pkgEnd < now) {
        console.log(`  [SKIP] uid=${member.uid} pkg=${pkg.pkgId} — already expired (end: ${pkgEnd.toISOString()})`);
        totalSkipped++;
        continue;
      }

      if (pkgStart <= todayCairo) {
        pkg.status = "ACTIVE";
        changed = true;
        totalFixed++;
        console.log(`  [FIX]  uid=${member.uid} pkg=${pkg.pkgId} — POSTPONED → ACTIVE (start: ${pkgStart.toISOString()})`);
      } else {
        console.log(`  [SKIP] uid=${member.uid} pkg=${pkg.pkgId} — genuinely future (start: ${pkgStart.toISOString()})`);
        totalSkipped++;
      }
    }

    if (changed) {
      await member.save();
    }
  }

  console.log("");
  console.log(`[DONE] Fixed: ${totalFixed} | Skipped: ${totalSkipped}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
