/**
 * set-member-package-statuses.ts
 *
 * Updates status on every entry in member.packages[] dynamically:
 *   EXPIRED   — pkgEndDate < now  (takes priority)
 *   COMPLETED — remainingClasses === 0
 *   ACTIVE    — valid date and remaining sessions
 *   FROZEN    — currently frozen
 *   DELETED   — deleted
 *
 * Run from tms_api/: npx ts-node src/scripts/set-member-package-statuses.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import { PackageStatusService } from "../services/package-status-service";

async function main() {
  await connectDB();

  console.log("Syncing all member package statuses...");
  const { updatedMembers, updatedPkgs } =
    await PackageStatusService.syncAllPackageStatuses();

  console.log(
    `Done. Members updated: ${updatedMembers}, packages updated: ${updatedPkgs}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
