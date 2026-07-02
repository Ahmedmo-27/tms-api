/**
 * check-package-deletion-impact.ts
 *
 * Read-only CLI to preview which members would be damaged if a package is deleted.
 *
 * Usage:
 *   npx ts-node src/scripts/check-package-deletion-impact.ts <packageId>
 *   npx ts-node src/scripts/check-package-deletion-impact.ts 6a42867d94c393587ec93fbb
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import { getPackageDeletionImpact } from "../services/package-deletion-guard";

async function main() {
  const packageId = process.argv[2];
  if (!packageId) {
    console.error(
      "Usage: npx ts-node src/scripts/check-package-deletion-impact.ts <packageId>",
    );
    process.exit(1);
  }

  await connectDB();
  const impact = await getPackageDeletionImpact(packageId);

  console.log("\n=== Package deletion impact ===\n");
  console.log(`Package ID:   ${impact.packageId}`);
  console.log(`Name:         ${impact.packageName ?? "(not in catalog)"}`);
  console.log(`Category:     ${impact.packageCategory ?? "—"}`);
  console.log(`Subscriptions: ${impact.totalSubscriptions} total, ${impact.activeSubscriptions} active`);
  console.log(`Payments:     ${impact.paymentCount} total, ${impact.nonRefundedPaymentCount} non-refunded`);
  console.log(`\n${impact.warningMessage}\n`);

  if (impact.affectedMembers.length > 0) {
    console.log("Affected member subscriptions:");
    for (const m of impact.affectedMembers) {
      console.log(
        `  - ${m.name ?? "Unknown"} | ${m.phoneNumber ?? "—"} | ${m.status} | ${m.pkgStartDate.toISOString().slice(0, 10)} → ${m.pkgEndDate.toISOString().slice(0, 10)}`,
      );
    }
  }

  const wouldDamage =
    impact.activeSubscriptions > 0 || impact.nonRefundedPaymentCount > 0;
  process.exitCode = wouldDamage ? 2 : 0;

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
