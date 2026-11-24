/**
 * Local end-to-end check of migrate-packages-to-all-locations against
 * mongodb-memory-server (no real cluster required).
 *
 * Usage:
 *   npx ts-node src/scripts/verify-migrate-packages-to-all-locations-local.ts
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import Package from "../models/package";
import Location from "../models/location";
import {
  collectBranchLabels,
  decidePackageLocationMigration,
} from "../utils/package-location-migration";

async function main() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const cairo = await Location.create({
    branchName: "The Mind Space",
    location: "New Cairo",
    locationUrl: "https://maps.example.com/cairo",
  });
  const matcha = await Location.create({
    branchName: "Matcha",
    location: "Matcha North Coast",
    locationUrl: "https://maps.example.com/matcha",
  });

  const clearMe = await Package.create({
    name: "10 Studio",
    category: "STUDIO",
    price: 3900,
    expiryPeriod: 60,
    numberOfSessions: 10,
    locationId: cairo._id,
  });
  const keepCairo = await Package.create({
    name: "Open Gym Weekly — Cairo",
    category: "OPEN_GYM",
    price: 800,
    expiryPeriod: 7,
    numberOfSessions: 10000,
    locationId: cairo._id,
  });
  const keepMatcha = await Package.create({
    name: "Open Gym Matcha 14d",
    category: "OPEN_GYM",
    price: 900,
    expiryPeriod: 14,
    numberOfSessions: 10000,
    locationId: matcha._id,
  });
  const alreadyAll = await Package.create({
    name: "5 Studio",
    category: "STUDIO",
    price: 2250,
    expiryPeriod: 30,
    numberOfSessions: 5,
    locationId: null,
  });

  const labels = collectBranchLabels(
    await Location.find({}).select("branchName location").lean(),
  );
  const decisions = (await Package.find({}).lean()).map((pkg) =>
    decidePackageLocationMigration(pkg as any, labels),
  );
  const toClear = decisions.filter((d) => d.action === "clear_location");

  if (toClear.length !== 1 || toClear[0].packageId !== clearMe._id.toString()) {
    throw new Error(
      `Expected only "10 Studio" to clear, got: ${JSON.stringify(toClear, null, 2)}`,
    );
  }

  await Package.updateMany(
    { _id: { $in: toClear.map((d) => new Types.ObjectId(d.packageId)) } },
    { $set: { locationId: null } },
  );

  const after = await Package.find({
    _id: { $in: [clearMe._id, keepCairo._id, keepMatcha._id, alreadyAll._id] },
  }).lean();

  const byId = new Map(after.map((p) => [p._id.toString(), p]));
  const cleared = byId.get(clearMe._id.toString());
  const cairoKept = byId.get(keepCairo._id.toString());
  const matchaKept = byId.get(keepMatcha._id.toString());
  const stillAll = byId.get(alreadyAll._id.toString());

  if (cleared?.locationId != null) {
    throw new Error("10 Studio should now be all-locations (locationId null)");
  }
  if (String(cairoKept?.locationId) !== String(cairo._id)) {
    throw new Error("Cairo-named open gym should keep its locationId");
  }
  if (String(matchaKept?.locationId) !== String(matcha._id)) {
    throw new Error("Matcha-named open gym should keep its locationId");
  }
  if (stillAll?.locationId != null) {
    throw new Error("5 Studio should remain all-locations");
  }

  console.log("VERIFY OK");
  console.log(
    JSON.stringify(
      {
        cleared: { id: clearMe._id.toString(), name: clearMe.name, locationId: cleared?.locationId ?? null },
        keptBranchNamed: [
          { id: keepCairo._id.toString(), name: keepCairo.name, locationId: String(cairoKept?.locationId) },
          { id: keepMatcha._id.toString(), name: keepMatcha.name, locationId: String(matchaKept?.locationId) },
        ],
        alreadyAll: { id: alreadyAll._id.toString(), name: alreadyAll.name, locationId: stillAll?.locationId ?? null },
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
  await mongod.stop();
}

main().catch(async (err) => {
  console.error("VERIFY FAILED:", err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
