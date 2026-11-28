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

const MEMBER_BATCH_CURSOR_SIZE = 50;

// Select the whole packages array — projecting nested package fields alone can
 // yield empty arrays under Mongoose lean cursors.
const MEMBER_SELECT =
  "_id uid soldBy soldByAssignedAt soldByAssignedBy packages";

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

function packageAttributionForUpdate(
  packages: BackfillPackageInput[],
  plan: NonNullable<ReturnType<typeof planMemberSoldByBackfill>>,
  migrationRunAt: Date,
): {
  soldBy: Types.ObjectId;
  soldByAssignedAt: Date | null;
  soldByAssignedBy: Types.ObjectId | null;
} {
  const nextPackages = applySoldByBackfillToPackages(packages, plan, {
    migrationRunAt,
  });
  const sampleId = plan.packageIdsToUpdate[0];
  const patched = nextPackages.find((p) => p._id === sampleId);
  const soldByAssignedAt =
    (patched?.soldByAssignedAt as Date | undefined) ??
    plan.attribution.soldByAssignedAt ??
    migrationRunAt;
  const soldByAssignedByRaw =
    patched?.soldByAssignedBy ?? plan.attribution.soldByAssignedBy;

  return {
    soldBy: new Types.ObjectId(plan.attribution.soldBy),
    soldByAssignedAt: soldByAssignedAt ?? null,
    soldByAssignedBy: soldByAssignedByRaw
      ? new Types.ObjectId(String(soldByAssignedByRaw))
      : null,
  };
}

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

  // $elemMatch + $type avoids empty-array false positives from `$ne: null`.
  const query = {
    $or: [
      { soldBy: { $type: "objectId" } },
      {
        packages: {
          $elemMatch: { soldBy: { $type: "objectId" } },
        },
      },
    ],
  };

  let examined = 0;
  let updated = 0;
  let packagesTouched = 0;
  let membersSet = 0;
  let skipped = 0;
  const conflicts: SoldByConflictLog[] = [];

  const cursor = Member.find(query)
    .select(MEMBER_SELECT)
    .lean<MemberLean>()
    .cursor({ batchSize: MEMBER_BATCH_CURSOR_SIZE });

  for await (const doc of cursor) {
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

    if (plan.memberFieldsChanged) {
      membersSet += 1;
    }

    if (plan.packageIdsToUpdate.length > 0) {
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

    const $set: Record<string, unknown> = {};
    const arrayFilters: Record<string, unknown>[] = [];

    if (plan.memberFieldsChanged) {
      $set.soldBy = new Types.ObjectId(plan.attribution.soldBy);
      $set.soldByAssignedAt = plan.attribution.soldByAssignedAt;
      $set.soldByAssignedBy = plan.attribution.soldByAssignedBy
        ? new Types.ObjectId(plan.attribution.soldByAssignedBy)
        : null;
    }

    if (plan.packageIdsToUpdate.length > 0) {
      const pkgAttribution = packageAttributionForUpdate(
        packages,
        plan,
        migrationRunAt,
      );
      const pkgObjectIds = plan.packageIdsToUpdate.map(
        (id) => new Types.ObjectId(id),
      );

      $set["packages.$[pkg].soldBy"] = pkgAttribution.soldBy;
      $set["packages.$[pkg].soldByAssignedAt"] =
        pkgAttribution.soldByAssignedAt;
      $set["packages.$[pkg].soldByAssignedBy"] =
        pkgAttribution.soldByAssignedBy;

      arrayFilters.push({ "pkg._id": { $in: pkgObjectIds } });
    }

    const updateOptions =
      arrayFilters.length > 0 ? { arrayFilters } : undefined;

    await Member.updateOne({ _id: doc._id }, { $set }, updateOptions);
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