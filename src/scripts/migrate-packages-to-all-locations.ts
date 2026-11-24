/**
 * migrate-packages-to-all-locations.ts
 *
 * Clears Package.locationId (all locations) for catalog packages that are
 * currently scoped to a single branch, except packages whose name includes a
 * known branch / place label (e.g. "Cairo", "Matcha", "New Cairo").
 *
 * Does not modify member subscriptions, payments, or other collections.
 *
 * Usage:
 *   Dry-run against prod.env (default):
 *     npx ts-node src/scripts/migrate-packages-to-all-locations.ts
 *
 *   Apply to production:
 *     npx ts-node src/scripts/migrate-packages-to-all-locations.ts --apply
 *
 *   Target dev instead of prod:
 *     npx ts-node src/scripts/migrate-packages-to-all-locations.ts --dev
 *     npx ts-node src/scripts/migrate-packages-to-all-locations.ts --dev --apply
 *
 *   Or set MONGO_URI / TMS_ENV_FILE in the environment.
 */

import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import Package from "../models/package";
import Location from "../models/location";
import {
  collectBranchLabels,
  decidePackageLocationMigration,
  PackageLocationMigrationDecision,
} from "../utils/package-location-migration";
import { describeMongoTarget } from "./script-db";

function resolveMongoUri(): string {
  if (process.env.MONGO_URI?.trim()) {
    return process.env.MONGO_URI.trim();
  }

  const isDev = process.argv.includes("--dev");
  const envFile = process.env.TMS_ENV_FILE || (isDev ? "dev.env" : "prod.env");
  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    throw new Error(
      `MONGO_URI is not set. Add it to ${envFile}, export MONGO_URI, ` +
        "or point TMS_ENV_FILE at the env file for the deployment you mean.",
    );
  }
  return uri;
}

function isApply(): boolean {
  return process.argv.includes("--apply") && !process.argv.includes("--dry-run");
}

function printDecision(decision: PackageLocationMigrationDecision): void {
  if (decision.action === "clear_location") {
    console.log(
      `  [CLEAR] ${decision.packageId}  "${decision.name}"  (${decision.category ?? "?"})  locationId=${decision.locationId}`,
    );
    return;
  }

  if (decision.reason === "branch_name_in_package_name") {
    console.log(
      `  [KEEP ] ${decision.packageId}  "${decision.name}"  matched="${decision.matchedLabel}"  locationId=${decision.locationId}`,
    );
    return;
  }
}

async function main() {
  const apply = isApply();
  const uri = resolveMongoUri();

  console.log(`\n======================================================================`);
  console.log(` PACKAGE → ALL LOCATIONS MIGRATION`);
  console.log(` Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);
  console.log(` Target: ${describeMongoTarget(uri)}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================================\n`);

  await mongoose.connect(uri);

  const locations = await Location.find({})
    .select("branchName location")
    .lean();
  const branchLabels = collectBranchLabels(locations);

  console.log(`Branch labels used for name matching (${branchLabels.length}):`);
  for (const label of branchLabels) {
    console.log(`  - ${label}`);
  }
  console.log("");

  const packages = await Package.find({})
    .select("name category locationId isDeprecated hidden")
    .lean();

  const decisions = packages.map((pkg) =>
    decidePackageLocationMigration(pkg as any, branchLabels),
  );

  const toClear = decisions.filter((d) => d.action === "clear_location");
  const keptBranchNamed = decisions.filter(
    (d) => d.action === "keep" && d.reason === "branch_name_in_package_name",
  );
  const alreadyAll = decisions.filter(
    (d) => d.action === "keep" && d.reason === "already_all_locations",
  );

  console.log(`Catalog packages scanned: ${packages.length}`);
  console.log(`  Already all-locations:     ${alreadyAll.length}`);
  console.log(`  Keep (branch name in title): ${keptBranchNamed.length}`);
  console.log(`  Clear → all locations:     ${toClear.length}\n`);

  if (keptBranchNamed.length > 0) {
    console.log(`Kept (branch name in package name):`);
    for (const d of keptBranchNamed) printDecision(d);
    console.log("");
  }

  if (toClear.length === 0) {
    console.log("Nothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Packages to clear locationId:`);
  for (const d of toClear) printDecision(d);
  console.log("");

  if (!apply) {
    console.log(
      "Dry-run complete. Re-run with --apply to set locationId=null on the CLEAR rows.",
    );
    await mongoose.disconnect();
    return;
  }

  const ids = toClear.map((d) => new mongoose.Types.ObjectId(d.packageId));
  const result = await Package.updateMany(
    { _id: { $in: ids } },
    { $set: { locationId: null } },
  );

  console.log(
    `Applied: matched=${result.matchedCount ?? (result as any).n}  ` +
      `modified=${result.modifiedCount ?? (result as any).nModified}`,
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
