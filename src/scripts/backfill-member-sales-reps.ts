/**
 * backfill-member-sales-reps.ts
 *
 * Backfills `member.salesRep` from existing `packages[].soldBy` values and
 * ensures all non-deleted packages on a member are marked as sold by that
 * member's linked sales rep.
 *
 * Dry-run by default. Pass `--apply` to write changes.
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-member-sales-reps.ts
 *   TMS_ENV_FILE=prod.env npx ts-node src/scripts/backfill-member-sales-reps.ts
 *   TMS_ENV_FILE=prod.env npx ts-node src/scripts/backfill-member-sales-reps.ts --apply
 */

import mongoose, { Types } from "mongoose";
import Member from "../models/member";
import { describeMongoTarget, resolveScriptMongoUri } from "./script-db";

const APPLY = process.argv.includes("--apply");

interface RawPackage {
  _id?: Types.ObjectId;
  status?: string;
  pkgStartDate?: Date;
  soldBy?: Types.ObjectId | null;
  soldByAssignedAt?: Date | null;
  soldByAssignedBy?: Types.ObjectId | null;
}

function isDeleted(status: unknown): boolean {
  return String(status ?? "").toUpperCase() === "DELETED";
}

function sortTime(pkg: RawPackage): number {
  const date = pkg.soldByAssignedAt ?? pkg.pkgStartDate;
  return date ? new Date(date).getTime() : 0;
}

async function run() {
  const mongoUri = resolveScriptMongoUri();
  console.log(`Target DB: ${describeMongoTarget(mongoUri)}`);
  console.log(`Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);

  await mongoose.connect(mongoUri);

  try {
    const members = await Member.find({
      $or: [
        { salesRep: { $ne: null } },
        { "packages.soldBy": { $ne: null } },
      ],
    })
      .select("uid salesRep salesRepAssignedAt salesRepAssignedBy packages")
      .lean();

    let backfilledMembers = 0;
    let syncedMembers = 0;
    let packagesUpdated = 0;
    let conflicts = 0;

    for (const member of members) {
      const uid = member.uid;
      const pkgs = (Array.isArray(member.packages) ? member.packages : []) as RawPackage[];
      const livePkgs = pkgs.filter((pkg) => !isDeleted(pkg.status));

      if (member.salesRep) {
        const repIdStr = String(member.salesRep);
        const needsSync = livePkgs.some(
          (pkg) => !pkg.soldBy || String(pkg.soldBy) !== repIdStr,
        );
        if (!needsSync) continue;

        syncedMembers += 1;
        const mismatchedCount = livePkgs.filter(
          (pkg) => !pkg.soldBy || String(pkg.soldBy) !== repIdStr,
        ).length;
        packagesUpdated += mismatchedCount;

        if (APPLY) {
          await Member.updateOne(
            { _id: member._id },
            {
              $set: {
                "packages.$[pkg].soldBy": member.salesRep,
                "packages.$[pkg].soldByAssignedAt":
                  member.salesRepAssignedAt ?? new Date(),
                "packages.$[pkg].soldByAssignedBy":
                  member.salesRepAssignedBy ?? null,
              },
            },
            {
              arrayFilters: [
                { "pkg.status": { $not: { $regex: "^deleted$", $options: "i" } } },
              ],
            },
          );
        }
        continue;
      }

      const pkgsWithSeller = livePkgs
        .filter((pkg) => Boolean(pkg.soldBy))
        .sort((a, b) => sortTime(b) - sortTime(a));

      if (pkgsWithSeller.length === 0) continue;

      const distinctSellers = Array.from(
        new Set(pkgsWithSeller.map((pkg) => String(pkg.soldBy))),
      );
      if (distinctSellers.length > 1) {
        conflicts += 1;
        console.warn(
          `[CONFLICT] uid=${String(uid)} has multiple sellers on packages (${distinctSellers.join(", ")}). Using most recent: ${distinctSellers[0]}`,
        );
      }

      const chosen = pkgsWithSeller[0];
      const chosenSeller = chosen.soldBy!;
      const chosenAt = chosen.soldByAssignedAt ?? new Date();
      const chosenBy = chosen.soldByAssignedBy ?? null;

      backfilledMembers += 1;
      const mismatchedCount = livePkgs.filter(
        (pkg) => !pkg.soldBy || String(pkg.soldBy) !== String(chosenSeller),
      ).length;
      packagesUpdated += mismatchedCount;

      if (APPLY) {
        await Member.updateOne(
          { _id: member._id },
          {
            $set: {
              salesRep: chosenSeller,
              salesRepAssignedAt: chosenAt,
              salesRepAssignedBy: chosenBy,
              "packages.$[pkg].soldBy": chosenSeller,
              "packages.$[pkg].soldByAssignedAt": chosenAt,
              "packages.$[pkg].soldByAssignedBy": chosenBy,
            },
          },
          {
            arrayFilters: [
              { "pkg.status": { $not: { $regex: "^deleted$", $options: "i" } } },
            ],
          },
        );
      }
    }

    console.log("\nSummary:");
    console.log(`  Candidate members scanned: ${members.length}`);
    console.log(`  Members backfilled (salesRep set): ${backfilledMembers}`);
    console.log(`  Members synced (packages updated): ${syncedMembers}`);
    console.log(`  Non-deleted packages updated: ${packagesUpdated}`);
    console.log(`  Members with multiple distinct sellers: ${conflicts}`);
    if (!APPLY) {
      console.log("\nDry run complete. Re-run with --apply to write changes.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
