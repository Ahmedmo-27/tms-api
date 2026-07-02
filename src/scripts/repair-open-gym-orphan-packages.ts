/**
 * repair-open-gym-orphan-packages.ts
 *
 * Restores deleted open gym catalog packages (same _id) and repairs member
 * subscriptions that were orphaned when those packages were removed.
 *
 * Affected prod pkgIds (Jun 2026 incident):
 *   - 6a42867d94c393587ec93fbb  Open Gym Monthly — Cairo
 *   - 6a42867d94c393587ec91002  Open Gym Weekly — Cairo
 *
 * Usage:
 *   npx ts-node src/scripts/repair-open-gym-orphan-packages.ts --dry-run
 *   npx ts-node src/scripts/repair-open-gym-orphan-packages.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Package from "../models/package";
import Member from "../models/member";
import User from "../models/user";

const CAIRO_LOCATION_ID = "69ec4abad8394559ce7ca77c";

const RESTORED_PACKAGES = [
  {
    _id: "6a42867d94c393587ec93fbb",
    name: "Open Gym Monthly — Cairo",
    category: "OPEN_GYM" as const,
    price: 2750,
    expiryPeriod: 30,
    numberOfSessions: 10000,
    locationId: CAIRO_LOCATION_ID,
    opensClasses: [] as Types.ObjectId[],
  },
  {
    _id: "6a42867d94c393587ec91002",
    name: "Open Gym Weekly — Cairo",
    category: "OPEN_GYM" as const,
    price: 800,
    expiryPeriod: 7,
    numberOfSessions: 10000,
    locationId: CAIRO_LOCATION_ID,
    opensClasses: [] as Types.ObjectId[],
  },
] as const;

const ORPHAN_PKG_IDS = RESTORED_PACKAGES.map((p) => p._id);

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function restoreCatalogPackages(dryRun: boolean) {
  console.log("\n=== Restore catalog packages ===");
  for (const spec of RESTORED_PACKAGES) {
    const existing = await Package.findById(spec._id);
    if (existing) {
      console.log(`[SKIP] ${spec.name} (${spec._id}) already exists`);
      continue;
    }

    console.log(`[CREATE] ${spec.name} (${spec._id})`);
    if (!dryRun) {
      await Package.create({
        _id: new Types.ObjectId(spec._id),
        name: spec.name,
        category: spec.category,
        price: spec.price,
        expiryPeriod: spec.expiryPeriod,
        numberOfSessions: spec.numberOfSessions,
        locationId: new Types.ObjectId(spec.locationId),
        opensClasses: spec.opensClasses,
      });
    }
  }
}

async function repairMemberSubscriptions(dryRun: boolean) {
  console.log("\n=== Repair member subscriptions ===");
  const now = new Date();
  const members = await Member.find({
    "packages.pkgId": { $in: ORPHAN_PKG_IDS.map((id) => new Types.ObjectId(id)) },
  });

  for (const member of members) {
    const user = await User.findById(member.uid);
    let dirty = false;

    for (const pkg of member.packages) {
      const pkgId = pkg.pkgId.toString();
      if (!ORPHAN_PKG_IDS.includes(pkgId as (typeof ORPHAN_PKG_IDS)[number])) {
        continue;
      }

      if (!pkg.locationId) {
        console.log(
          `[LOCATION] ${user?.name ?? member.uid}: set locationId → Cairo`,
        );
        pkg.locationId = new Types.ObjectId(CAIRO_LOCATION_ID);
        dirty = true;
      }

      if (
        pkg.status === "ACTIVE" &&
        pkg.pkgEndDate < now
      ) {
        console.log(
          `[EXPIRE] ${user?.name ?? member.uid}: ${pkgId} ended ${pkg.pkgEndDate.toISOString()}`,
        );
        pkg.status = "EXPIRED";
        dirty = true;
      }
    }

    if (dirty) {
      if (!dryRun) {
        await member.save();
      }
      console.log(`[SAVED] ${user?.name ?? member.uid}`);
    } else {
      console.log(`[OK] ${user?.name ?? member.uid} — no subscription fixes needed`);
    }
  }
}

async function printSummary() {
  console.log("\n=== Post-repair summary ===");
  for (const spec of RESTORED_PACKAGES) {
    const inCatalog = await Package.findById(spec._id);
    const subs = await Member.find({
      "packages.pkgId": new Types.ObjectId(spec._id),
    });
    const active = subs.filter((m) =>
      m.packages.some(
        (p) => p.pkgId.toString() === spec._id && p.status === "ACTIVE",
      ),
    );

    console.log(`${spec.name}:`);
    console.log(`  catalog: ${inCatalog ? "present" : "MISSING"}`);
    console.log(`  members: ${subs.length} total, ${active.length} active`);
    for (const m of subs) {
      const u = await User.findById(m.uid);
      const sub = m.packages.find((p) => p.pkgId.toString() === spec._id);
      console.log(
        `    - ${u?.name ?? m.uid} | ${sub?.status} | ${sub?.pkgStartDate?.toISOString?.()?.slice(0, 10)} → ${sub?.pkgEndDate?.toISOString?.()?.slice(0, 10)}`,
      );
    }
  }
}

async function main() {
  const dryRun = isDryRun();
  if (dryRun) {
    console.log("DRY RUN — no writes will be performed\n");
  }

  await connectDB();
  await restoreCatalogPackages(dryRun);
  await repairMemberSubscriptions(dryRun);
  await printSummary();

  await mongoose.disconnect();
  console.log(dryRun ? "\nDry run complete." : "\nRepair complete.");
}

main().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
