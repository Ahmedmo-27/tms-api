/**
 * Local verification for location ObjectId fix (in-memory MongoDB).
 * Run: npx ts-node src/scripts/verify-location-fix-local.ts
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import Class from "../models/class";
import Location from "../models/location";
import User from "../models/user";
import Payment from "../models/payment";
import {
  locationIdScalarQuery,
  locationIdsArrayQuery,
  resolveLocationFilter,
  toObjectId,
} from "../utils/location-scope";
import { BookingsService } from "../services/bookings-service";
import { Request } from "express";

const CAIRO_ID = "69ec4abad8394559ce7ca77c";
const MATCHA_ID = "6a3e9509c72a8d349f150910";

const STRENGTH_TITLES = [
  "Strength (Quads, Back, Shoulders)",
  "Strength (Hyrox)",
  "Strength (Full Body)",
  "Strength (Hams, Glutes, Chest & Arms)",
  "Strength (Lower Body-Focused)",
  "Strength (Upper Body-Focused)",
  "Strength (Core-Focused)",
];

/** Same titles that were stored as strings in prod (simulated). */
const STRING_LOCATION_TITLES = new Set([
  "Strength (Lower Body-Focused)",
  "Strength (Upper Body-Focused)",
  "Strength (Core-Focused)",
]);

type CheckResult = { name: string; ok: boolean; detail: string };

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function insertClassRaw(
  db: mongoose.mongo.Db,
  title: string,
  locationValue: string | Types.ObjectId,
) {
  await db.collection("classes").insertOne({
    title,
    category: "FUNCTIONAL_TRAINING",
    price: 450,
    locations: [locationValue],
    points: 1,
    allowDropIn: true,
  });
}

async function runMigration(db: mongoose.mongo.Db, dryRun: boolean): Promise<number> {
  const classes = await db.collection("classes").find({}).toArray();
  let fixed = 0;

  for (const cls of classes) {
    if (!Array.isArray(cls.locations)) continue;
    let changed = false;
    const normalized = cls.locations.map((loc: unknown) => {
      if (loc instanceof Types.ObjectId) return loc;
      if (typeof loc === "string" && Types.ObjectId.isValid(loc)) {
        changed = true;
        return new Types.ObjectId(loc);
      }
      return loc;
    });
    if (changed) {
      fixed += 1;
      if (!dryRun) {
        await db.collection("classes").updateOne(
          { _id: cls._id },
          { $set: { locations: normalized } },
        );
      }
    }
  }
  return fixed;
}

function mockBranchAdminRequest(locationId: string): Request {
  return {
    user: {
      role: "branch_admin",
      locationId: new Types.ObjectId(locationId),
    },
    query: {},
    body: {},
  } as unknown as Request;
}

function mockManagementRequest(locationId?: string): Request {
  return {
    user: { role: "management" },
    query: locationId ? { locationId } : {},
    body: {},
  } as unknown as Request;
}

async function queryCatalogLikeController(
  req: Request,
): Promise<Array<{ title: string }>> {
  const targetLocationId = resolveLocationFilter(req);
  const query: Record<string, unknown> = {};
  if (targetLocationId && Types.ObjectId.isValid(targetLocationId)) {
    Object.assign(query, locationIdsArrayQuery(targetLocationId));
  }
  const classes = await Class.find(query).select("title").lean();
  return classes.map((c) => ({ title: c.title }));
}

async function main() {
  console.log("\n=== Local verification: location ObjectId fix ===\n");

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const db = mongoose.connection.db!;
  console.log("In-memory MongoDB ready.\n");

  await Location.create([
    {
      _id: new Types.ObjectId(CAIRO_ID),
      branchName: "Cairo",
      location: "Cairo",
      locationUrl: "https://example.com/cairo",
    },
    {
      _id: new Types.ObjectId(MATCHA_ID),
      branchName: "Matcha",
      location: "Matcha North Coast",
      locationUrl: "https://example.com/matcha",
    },
  ]);

  for (const title of STRENGTH_TITLES) {
    const loc = STRING_LOCATION_TITLES.has(title)
      ? CAIRO_ID
      : new Types.ObjectId(CAIRO_ID);
    await insertClassRaw(db, title, loc);
  }

  await insertClassRaw(db, "StrengthxPilates", new Types.ObjectId(MATCHA_ID));
  await insertClassRaw(db, "Strength on Mat", new Types.ObjectId(MATCHA_ID));

  await db.collection("classes").insertOne({
    title: "Open Gym Drop-In — Cairo",
    category: "WORKSPACE",
    price: 350,
    locations: [CAIRO_ID],
    allowDropIn: true,
  });

  await User.create({
    name: "Cairo Admin",
    phoneNumber: "01000000001",
    email: "cairo.admin@test.local",
    password: "Test@branch2026",
    role: "branch_admin",
    locationId: new Types.ObjectId(CAIRO_ID),
  });

  // --- Before migration / with new query fix ---
  const oldQueryCount = await Class.countDocuments({
    locations: new Types.ObjectId(CAIRO_ID),
  });
  check(
    "Old ObjectId-only query (buggy)",
    oldQueryCount === 4,
    `found ${oldQueryCount}/7 Cairo Strength classes`,
  );

  const branchAdminClasses = await queryCatalogLikeController(
    mockBranchAdminRequest(CAIRO_ID),
  );
  const branchAdminStrength = branchAdminClasses.filter((c) =>
    c.title.startsWith("Strength"),
  );
  check(
    "Branch admin catalog (new query)",
    branchAdminStrength.length === 7,
    `found ${branchAdminStrength.length}/7 Cairo Strength classes`,
  );

  for (const title of STRING_LOCATION_TITLES) {
    check(
      `Branch admin sees "${title}"`,
      branchAdminStrength.some((c) => c.title === title),
      branchAdminStrength.some((c) => c.title === title) ? "visible" : "missing",
    );
  }

  const managementAll = await queryCatalogLikeController(mockManagementRequest());
  check(
    "Management catalog (all branches)",
    managementAll.length === 10,
    `found ${managementAll.length} total classes (7 Cairo Strength + 2 Matcha + 1 WORKSPACE)`,
  );

  const managementCairo = await queryCatalogLikeController(
    mockManagementRequest(CAIRO_ID),
  );
  check(
    "Management filtered to Cairo",
    managementCairo.filter((c) => c.title.startsWith("Strength")).length === 7,
    `found ${managementCairo.length} Cairo classes`,
  );

  let openGymPrice: number | null = null;
  try {
    openGymPrice = await BookingsService.resolveOpenGymDropInPrice(CAIRO_ID);
  } catch {
    openGymPrice = null;
  }
  check(
    "Open gym drop-in price resolves for Cairo",
    openGymPrice === 350,
    openGymPrice != null ? `price=${openGymPrice}` : "not found",
  );

  // --- Migration dry run ---
  const dryRunFixes = await runMigration(db, true);
  check(
    "Migration dry run finds string locations",
    dryRunFixes === 4,
    `${dryRunFixes} class docs need normalization (3 Strength + 1 WORKSPACE)`,
  );

  // --- Apply migration ---
  const appliedFixes = await runMigration(db, false);
  check(
    "Migration apply updates documents",
    appliedFixes === 4,
    `${appliedFixes} class docs normalized`,
  );

  const postMigrationDryRun = await runMigration(db, true);
  check(
    "Migration idempotent (second dry run)",
    postMigrationDryRun === 0,
    `${postMigrationDryRun} remaining fixes`,
  );

  const upperBody = await db.collection("classes").findOne({
    title: "Strength (Upper Body-Focused)",
  });
  const upperBodyLoc = upperBody?.locations?.[0];
  check(
    "Upper Body-Focused location is ObjectId after migration",
    upperBodyLoc instanceof Types.ObjectId,
    `type=${upperBodyLoc instanceof Types.ObjectId ? "ObjectId" : typeof upperBodyLoc}`,
  );

  const postMigrationOldQuery = await Class.countDocuments({
    locations: new Types.ObjectId(CAIRO_ID),
  });
  check(
    "ObjectId-only query works after migration",
    postMigrationOldQuery >= 7,
    `found ${postMigrationOldQuery} Cairo classes`,
  );

  // --- Write path: processLocations fix via toObjectId ---
  const cast = toObjectId(CAIRO_ID);
  check(
    "toObjectId write helper",
    cast instanceof Types.ObjectId && cast.toString() === CAIRO_ID,
    cast?.toString() ?? "null",
  );

  const newClass = new Class({
    title: "Verify Write Path Class",
    category: "FUNCTIONAL_TRAINING",
    price: 100,
    locations: [cast],
    allowDropIn: true,
  });
  await newClass.save();
  const saved = await db.collection("classes").findOne({ title: "Verify Write Path Class" });
  check(
    "New class stores ObjectId in locations",
    saved?.locations?.[0] instanceof Types.ObjectId,
    `type=${saved?.locations?.[0] instanceof Types.ObjectId ? "ObjectId" : typeof saved?.locations?.[0]}`,
  );

  // --- Payments branch filter ---
  await db.collection("payments").insertOne({
    uid: new Types.ObjectId(),
    amount: 100,
    paymentMethod: "CASH",
    paymentTime: new Date(),
    purpose: "OTHER",
    isRefunded: false,
    locationId: CAIRO_ID,
  });
  const paymentStringMatch = await Payment.countDocuments(
    locationIdScalarQuery(CAIRO_ID),
  );
  check(
    "Payments branch filter matches string locationId",
    paymentStringMatch === 1,
    `matched ${paymentStringMatch} payment(s)`,
  );

  // Summary
  console.log("\n" + "=".repeat(55));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("=".repeat(55) + "\n");

  await mongoose.disconnect();
  await mongod.stop();

  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("Verification failed:", err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
