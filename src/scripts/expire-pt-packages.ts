/**
 * expire-pt-packages.ts
 *
 * Sets remainingClasses = 0 on all NonUserPackage PT records whose
 * pkgEndDate is before 22/4/2026.
 *
 * Idempotent — already-zeroed packages are skipped.
 * Run from tms_api/: npx ts-node src/scripts/expire-pt-packages.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import NonUserPackage from "../models/nonUserPackage";
import Package from "../models/package";

async function main() {
  await connectDB();

  const cutoff = new Date(2026, 3, 22); // April 22, 2026

  // Get all PT package IDs
  const ptPkgs = await Package.find({ category: "PERSONAL_TRAINING" }, "_id").lean();
  const ptPkgIds = ptPkgs.map((p) => p._id);

  const toExpire = await NonUserPackage.find({
    pkgId: { $in: ptPkgIds },
    pkgEndDate: { $lt: cutoff },
    remainingClasses: { $gt: 0 },
  }).lean();

  console.log(`Found ${toExpire.length} PT packages to expire.\n`);

  let expired = 0;
  for (const pkg of toExpire) {
    await NonUserPackage.updateOne({ _id: pkg._id }, { $set: { remainingClasses: 0 } });
    console.log(`[EXPIRED] ${pkg.name.padEnd(30)} | ${pkg.phoneNumber} | end: ${pkg.pkgEndDate.toISOString().slice(0, 10)} | was rem: ${pkg.remainingClasses}`);
    expired++;
  }

  console.log(`\nDone. Expired: ${expired}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
