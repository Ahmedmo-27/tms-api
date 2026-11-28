/**
 * backfill-member-level-sold-by.ts
 *
 * One-shot migration: legacy package-level sales attribution → member-level.
 * For each member with any sales attribution, sets member.soldBy and syncs every
 * non-deleted package to the same seller (deleted packages are left unchanged).
 *
 * Conflict rule when non-deleted packages disagree on seller and member.soldBy
 * is unset: prefer the seller on the package with the latest soldByAssignedAt,
 * else latest pkgStartDate, else lexicographically smallest package id.
 * When member.soldBy is already set, it wins and packages are synced to it.
 *
 * Usage:
 *   npx ts-node src/scripts/backfill-member-level-sold-by.ts --dry-run
 *   npx ts-node src/scripts/backfill-member-level-sold-by.ts
 *   TMS_ENV_FILE=prod.env npx ts-node src/scripts/backfill-member-level-sold-by.ts --dry-run
 *
 * npm:
 *   npm run backfill-member-sold-by
 *   npm run backfill-member-sold-by:apply
 */

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Member from "../models/member";
import {
  applySoldByBackfillToPackages,
  planMemberSoldByBackfill,
  SoldByConflictLog,
  type BackfillPackageInput,
} from "../utils/member-sold-by-backfill";
import { describeMongoTarget, resolveScriptMongoUri } from "./script-db";

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function idStr(value: unknown): string {
  return value ? String(value) : "";
}

type MemberLean = {
  _id: Types.ObjectId;
  uid: Types.ObjectId;
  soldBy?: Types.ObjectId | null;
  soldByAssignedAt?: Date | null;
  soldByAssignedBy?: Types.ObjectId | null;
  packages: Array<{
    _id: Types.ObjectId;
    status: string;
    soldBy?: Types.ObjectId | null;
    soldByAssignedAt?: Date | null;
    soldByAssignedBy?: Types.ObjectId | null;
    pkgStartDate?: Date | null;
    [key: string]: unknown;
  }>;
};

async function main() {
  const dryRun = isDryRun();
  const migrationRunAt = new Date();
  const mongoUri = resolveScriptMongoUri();

  console.log(
    `\nMember-level soldBy backfill (${dryRun ? "DRY RUN" : "APPLY"})`,
  );
  console.log(`Target: ${describeMongoTarget(mongoUri)}`);
  console.log(`Migration timestamp: ${migrationRunAt.toISOString()}\n`);

  await connectDB();

  const candidates = await Member.find({
    $or: [
      { soldBy: { $ne: null } },
      { "packages.soldBy": { $ne: null } },
    ],
  })
    .select("_id uid soldBy soldByAssignedAt soldByAssignedBy packages")
    .lean<MemberLean[]>();

  let examined = 0;
  let updated = 0;
  let packagesTouched = 0;
  let membersSet = 0;
  let skipped = 0;
  const conflicts: SoldByConflictLog[] = [];

  for (const doc of candidates) {
    examined += 1;
    const packages: BackfillPackageInput[] = doc.packages.map((p) => ({
      _id: idStr(p._id),
      status: String(p.status),
      soldBy: p.soldBy ?? null,
      soldByAssignedAt: p.soldByAssignedAt ?? null,
      soldByAssignedBy: p.soldByAssignedBy ?? null,
      pkgStartDate: p.pkgStartDate ?? null,
    }));

    const plan = planMemberSoldByBackfill(
      {
        memberId: idStr(doc._id),
        uid: idStr(doc.uid),
        soldBy: doc.soldBy ?? null,
        soldByAssignedAt: doc.soldByAssignedAt ?? null,
        soldByAssignedBy: doc.soldByAssignedBy ?? null,
        packages,
      },
      migrationRunAt,
    );

    if (!plan) {
      skipped += 1;
      continue;
    }

    if (plan.conflict) {
      conflicts.push(plan.conflict);
      console.warn(
        `[CONFLICT] member=${plan.memberId} uid=${plan.uid ?? "?"} ` +
          `sellers=[${plan.conflict.sellerIds.join(", ")}] ` +
          `chosen=${plan.conflict.chosenSellerId} ` +
          `via=${plan.conflict.tieBreak}`,
      );
    }

    const nextPackages = applySoldByBackfillToPackages(packages, plan, {
      migrationRunAt,
    });

    const $set: Record<string, unknown> = {};
    if (plan.memberFieldsChanged) {
      $set.soldBy = new Types.ObjectId(plan.attribution.soldBy);
      $set.soldByAssignedAt = plan.attribution.soldByAssignedAt;
      $set.soldByAssignedBy = plan.attribution.soldByAssignedBy
        ? new Types.ObjectId(plan.attribution.soldByAssignedBy)
        : null;
      membersSet += 1;
    }

    if (plan.packageIdsToUpdate.length > 0) {
      const mergedPackages = doc.packages.map((raw, index) => {
        const patch = nextPackages[index];
        if (!patch || !plan.packageIdsToUpdate.includes(idStr(raw._id))) {
          return raw;
        }
        return {
          ...raw,
          soldBy: new Types.ObjectId(plan.attribution.soldBy),
          soldByAssignedAt: patch.soldByAssignedAt ?? null,
          soldByAssignedBy: patch.soldByAssignedBy
            ? new Types.ObjectId(patch.soldByAssignedBy)
            : null,
        };
      });
      $set.packages = mergedPackages;
      packagesTouched += plan.packageIdsToUpdate.length;
    }
    updated += 1;

    if (dryRun) {
      console.log(
        `[DRY] member=${plan.memberId} packages=${plan.packageIdsToUpdate.length} ` +
          `memberFields=${plan.memberFieldsChanged} seller=${plan.attribution.soldBy}`,
      );
      continue;
    }

    await Member.updateOne({ _id: doc._id }, { $set });
  }

  console.log("\n=== Summary ===");
  console.log(`Examined:          ${examined}`);
  console.log(`Would update:      ${updated} members`);
  console.log(`Member.soldBy set: ${membersSet}`);
  console.log(`Packages synced:   ${packagesTouched}`);
  console.log(`Already in sync:   ${skipped}`);
  console.log(`Conflicts:         ${conflicts.length}`);

  if (dryRun) {
    console.log("\nDry run only — re-run without --dry-run to apply.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});