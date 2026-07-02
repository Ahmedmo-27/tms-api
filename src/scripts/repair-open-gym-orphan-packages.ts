/**
 * repair-open-gym-orphan-packages.ts
 *
 * Replaces orphaned member subscriptions (and related payments) that still
 * reference deleted open gym catalog packages with similar packages that
 * already exist in the database.
 *
 * Prod incident (Jun 2026) — deleted orphans:
 *   - 6a42867d94c393587ec93fbb  Open Gym Monthly — Cairo (2,750 EGP / 30 days)
 *   - 6a42867d94c393587ec91002  Open Gym Weekly — Cairo (800 EGP / 7 days)
 *
 * Replacements on prod:
 *   - 6a4382572ba8878c291be549  1 Month Space Membership New Cairo (2,750 / 30d)
 *   - 6a3c196b3661ee212b42d808  The Ultimate Mind Spacer 1 Week (7d, space access)
 *
 * Usage:
 *   npx ts-node src/scripts/repair-open-gym-orphan-packages.ts --dry-run
 *   npx ts-node src/scripts/repair-open-gym-orphan-packages.ts
 *   npx ts-node src/scripts/repair-open-gym-orphan-packages.ts --include-deleted
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Package from "../models/package";
import Member from "../models/member";
import User from "../models/user";
import Payment from "../models/payment";

const CAIRO_LOCATION_ID = "69ec4abad8394559ce7ca77c";

/** Orphan pkgId → existing catalog pkgId on prod */
const REPLACEMENT_MAP: Record<string, string> = {
  "6a42867d94c393587ec93fbb": "6a4382572ba8878c291be549",
  "6a42867d94c393587ec91002": "6a3c196b3661ee212b42d808",
};

const ORPHAN_PKG_IDS = Object.keys(REPLACEMENT_MAP);

const ORPHAN_LABELS: Record<string, string> = {
  "6a42867d94c393587ec93fbb": "Open Gym Monthly — Cairo (deleted)",
  "6a42867d94c393587ec91002": "Open Gym Weekly — Cairo (deleted)",
};

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function includeDeleted(): boolean {
  return process.argv.includes("--include-deleted");
}

async function validateReplacementPackages(): Promise<void> {
  console.log("\n=== Validate replacement packages exist ===");
  for (const [orphanId, replacementId] of Object.entries(REPLACEMENT_MAP)) {
    const replacement = await Package.findById(replacementId);
    if (!replacement) {
      throw new Error(
        `Replacement package ${replacementId} for orphan ${orphanId} was not found in the catalog.`,
      );
    }
    const orphanStillExists = await Package.findById(orphanId);
    if (orphanStillExists) {
      console.warn(
        `[WARN] Orphan ${orphanId} still exists in catalog as "${orphanStillExists.name}" — remap may be unnecessary.`,
      );
    }
    console.log(
      `[OK] ${ORPHAN_LABELS[orphanId]}\n        → ${replacement.name} (${replacementId}) | ${replacement.price} EGP | ${replacement.expiryPeriod}d`,
    );
  }
}

async function replaceMemberSubscriptions(dryRun: boolean): Promise<number> {
  console.log("\n=== Replace member subscriptions ===");
  const now = new Date();
  const statuses = includeDeleted()
    ? ["ACTIVE", "EXPIRED", "COMPLETED", "DELETED"]
    : ["ACTIVE", "EXPIRED", "COMPLETED"];

  let updated = 0;
  const members = await Member.find({
    "packages.pkgId": {
      $in: ORPHAN_PKG_IDS.map((id) => new Types.ObjectId(id)),
    },
  });

  for (const member of members) {
    const user = await User.findById(member.uid);

    for (const pkg of member.packages) {
      const orphanId = pkg.pkgId.toString();
      const replacementId = REPLACEMENT_MAP[orphanId];
      if (!replacementId) continue;
      if (!statuses.includes(pkg.status)) {
        console.log(
          `[SKIP] ${user?.name ?? member.uid} — ${orphanId} status=${pkg.status}`,
        );
        continue;
      }

      const replacement = await Package.findById(replacementId);
      const setExpired = pkg.status === "ACTIVE" && pkg.pkgEndDate < now;

      console.log(
        `[REMAP] ${user?.name ?? member.uid} | ${pkg.status} | ${ORPHAN_LABELS[orphanId]}\n        → ${replacement?.name} (${replacementId})\n        period: ${pkg.pkgStartDate.toISOString().slice(0, 10)} → ${pkg.pkgEndDate.toISOString().slice(0, 10)}`,
      );

      const $set: Record<string, unknown> = {
        "packages.$[pkg].pkgId": new Types.ObjectId(replacementId),
      };
      if (!pkg.locationId) {
        $set["packages.$[pkg].locationId"] = new Types.ObjectId(
          CAIRO_LOCATION_ID,
        );
        console.log(`        + set locationId → Cairo New Cairo`);
      }
      if (setExpired) {
        $set["packages.$[pkg].status"] = "EXPIRED";
        console.log(`        + marked EXPIRED (end date passed)`);
      }

      if (!dryRun) {
        const result = await Member.updateOne(
          {
            _id: member._id,
            "packages.pkgId": new Types.ObjectId(orphanId),
          },
          { $set },
          {
            arrayFilters: [{ "pkg.pkgId": new Types.ObjectId(orphanId) }],
          },
        );
        if (result.modifiedCount === 0) {
          console.warn(`        ! no documents modified`);
        } else {
          console.log(`        ✓ saved`);
        }
      }

      updated++;
    }
  }

  return updated;
}

async function replacePaymentReferences(dryRun: boolean): Promise<number> {
  console.log("\n=== Replace payment package references ===");
  let updated = 0;

  for (const [orphanId, replacementId] of Object.entries(REPLACEMENT_MAP)) {
    const payments = await Payment.find({
      pkgId: new Types.ObjectId(orphanId),
      isRefunded: { $ne: true },
    });

    for (const payment of payments) {
      const user = await User.findById(payment.uid);
      console.log(
        `[PAYMENT] ${user?.name ?? payment.uid} | ${payment.amount} ${payment.paymentMethod} | ${payment.note ?? "—"}\n          ${orphanId} → ${replacementId}`,
      );
      if (!dryRun) {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { pkgId: new Types.ObjectId(replacementId) } },
        );
      }
      updated++;
    }
  }

  return updated;
}

async function printSummary(): Promise<void> {
  console.log("\n=== Post-repair summary ===");

  for (const orphanId of ORPHAN_PKG_IDS) {
    const replacementId = REPLACEMENT_MAP[orphanId];
    const remaining = await Member.countDocuments({
      "packages.pkgId": new Types.ObjectId(orphanId),
    });
    const replacement = await Package.findById(replacementId);

    const repairedPayments = await Payment.find({
      pkgId: new Types.ObjectId(replacementId),
      note: /open gym/i,
    });

    console.log(`\n${ORPHAN_LABELS[orphanId]}:`);
    console.log(`  orphan references remaining: ${remaining}`);
    console.log(`  replacement catalog entry: ${replacement?.name} (${replacementId})`);

    for (const pay of repairedPayments) {
      const u = await User.findById(pay.uid);
      const m = await Member.findOne({ uid: pay.uid });
      const sub = m?.packages.find((p) => p.pkgId.toString() === replacementId);
      console.log(
        `    - ${u?.name ?? pay.uid} | ${sub?.status ?? "—"} | ${sub?.pkgStartDate?.toISOString?.()?.slice(0, 10) ?? "—"} → ${sub?.pkgEndDate?.toISOString?.()?.slice(0, 10) ?? "—"} | payment ${pay.isRefunded ? "REFUNDED" : "OK"}`,
      );
    }
  }

  const orphanPayments = await Payment.countDocuments({
    pkgId: { $in: ORPHAN_PKG_IDS.map((id) => new Types.ObjectId(id)) },
    isRefunded: { $ne: true },
  });
  console.log(`\nNon-refunded payments still pointing at orphan ids: ${orphanPayments}`);
}

async function main() {
  const dryRun = isDryRun();
  if (dryRun) {
    console.log("DRY RUN — no writes will be performed\n");
  }
  if (includeDeleted()) {
    console.log("Including DELETED subscriptions\n");
  }

  await connectDB();
  await validateReplacementPackages();
  const memberUpdates = await replaceMemberSubscriptions(dryRun);
  const paymentUpdates = await replacePaymentReferences(dryRun);
  await printSummary();

  await mongoose.disconnect();
  console.log(
    dryRun
      ? `\nDry run complete. Would update ${memberUpdates} subscription(s) and ${paymentUpdates} payment(s).`
      : `\nRepair complete. Updated ${memberUpdates} subscription(s) and ${paymentUpdates} payment(s).`,
  );
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
