/**
 * set-member-package-statuses.ts
 *
 * Updates status on every entry in member.packages[]:
 *   EXPIRED   — pkgEndDate < 22/4/2026  (takes priority)
 *   COMPLETED — remainingClasses === 0
 *   ACTIVE    — everything else
 *
 * Run from tms_api/: npx ts-node src/scripts/set-member-package-statuses.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Member from "../models/member";

async function main() {
  await connectDB();

  const cutoff = new Date(2026, 3, 22); // April 22, 2026
  const members = await Member.find({});

  let updatedMembers = 0;
  let updatedPkgs = 0;

  for (const member of members) {
    let dirty = false;

    for (const pkg of member.packages) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const newStatus =
        pkg.pkgEndDate < cutoff  ? "EXPIRED"   :
        pkg.remainingClasses <= 0 ? "COMPLETED" : 
        pkg.pkgStartDate > today ? "POSTPONED" : "ACTIVE";

      if (pkg.status !== newStatus) {
        pkg.status = newStatus;
        dirty = true;
        updatedPkgs++;
      }
    }

    if (dirty) {
      await member.save();
      updatedMembers++;
    }
  }

  console.log(`Done. Members updated: ${updatedMembers}, packages updated: ${updatedPkgs}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
