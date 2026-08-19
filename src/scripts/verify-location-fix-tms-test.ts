/**
 * Verification checklist against TMS_TEST (or any configured MONGO_URI).
 * Run: npx ts-node src/scripts/verify-location-fix-tms-test.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";
import User from "../models/user";
import Payment from "../models/payment";
import ScheduledClass from "../models/scheduledClass";
import { BookingsService } from "../services/bookings-service";
import { Request } from "express";
import {
  locationIdScalarQuery,
  locationIdsArrayQuery,
  resolveLocationFilter,
} from "../utils/location-scope";

const CAIRO_ID = "69ec4abad8394559ce7ca77c";
const MISSING_STRENGTH = [
  "Strength (Lower Body-Focused)",
  "Strength (Upper Body-Focused)",
  "Strength (Core-Focused)",
];

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function mockBranchAdminRequest(locationId: string): Request {
  return {
    user: { role: "branch_admin", locationId: new Types.ObjectId(locationId) },
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

async function queryCatalog(req: Request): Promise<string[]> {
  const targetLocationId = resolveLocationFilter(req);
  const query: Record<string, unknown> = {};
  if (targetLocationId && Types.ObjectId.isValid(targetLocationId)) {
    Object.assign(query, locationIdsArrayQuery(targetLocationId));
  }
  const classes = await Class.find(query).select("title").lean();
  return classes.map((c) => c.title);
}

async function countStringLocationClasses(db: mongoose.mongo.Db): Promise<number> {
  return db.collection("classes").countDocuments({
    locations: { $elemMatch: { $type: "string" } },
  });
}

async function main() {
  console.log("\n=== TMS_TEST verification checklist ===\n");
  await connectDB();
  const db = mongoose.connection.db!;

  const cairoAdmin = await User.findOne({
    role: "branch_admin",
    locationId: new Types.ObjectId(CAIRO_ID),
  }).select("name phoneNumber email locationId role");

  check(
    "Cairo branch_admin account exists",
    !!cairoAdmin,
    cairoAdmin
      ? `${cairoAdmin.name} (${cairoAdmin.email ?? cairoAdmin.phoneNumber})`
      : "no user with locationId=Cairo",
  );

  const stringLocCount = await countStringLocationClasses(db);
  check(
    "Data state: string location ids in classes",
    true,
    `${stringLocCount} class(es) still have string locations[0]`,
  );

  const oldQueryTitles = (
    await Class.find({ locations: new Types.ObjectId(CAIRO_ID) })
      .select("title")
      .lean()
  ).map((c) => c.title);

  const branchTitles = await queryCatalog(mockBranchAdminRequest(CAIRO_ID));
  const branchStrength = branchTitles.filter((t) => t.startsWith("Strength"));

  check(
    "Old ObjectId-only query (pre-fix behavior)",
    true,
    `${oldQueryTitles.filter((t) => t.startsWith("Strength")).length} Cairo Strength classes`,
  );

  for (const title of MISSING_STRENGTH) {
    const inOld = oldQueryTitles.includes(title);
    const inNew = branchTitles.includes(title);
    check(
      `"${title}" visible to branch_admin (new query)`,
      inNew,
      inNew ? "visible" : "missing",
    );
    if (stringLocCount > 0 && inOld === inNew) {
      check(
        `"${title}" blocked by old query only`,
        !inOld && inNew,
        `old=${inOld ? "yes" : "no"}, new=${inNew ? "yes" : "no"}`,
      );
    }
  }

  check(
    "Branch admin Cairo Strength catalog count",
    branchStrength.length >= 7,
    `${branchStrength.length} Strength classes (expected ≥7)`,
  );

  const managementAll = await queryCatalog(mockManagementRequest());
  check(
    "Management catalog (all branches, no filter)",
    managementAll.length > branchTitles.length,
    `${managementAll.length} total classes`,
  );

  const managementCairo = await queryCatalog(mockManagementRequest(CAIRO_ID));
  check(
    "Management filtered to Cairo",
    managementCairo.length === branchTitles.length,
    `${managementCairo.length} Cairo classes`,
  );

  let openGymPrice: number | null = null;
  try {
    openGymPrice = await BookingsService.resolveOpenGymDropInPrice(CAIRO_ID);
  } catch (e) {
    openGymPrice = null;
  }
  check(
    "Open gym drop-in price resolves for Cairo",
    openGymPrice != null && openGymPrice >= 0,
    openGymPrice != null ? `price=${openGymPrice} EGP` : "not configured / not found",
  );

  const today = new Date();
  const paymentCount = await Payment.countDocuments({
    ...locationIdScalarQuery(CAIRO_ID),
    paymentTime: {
      $gte: new Date(today.getFullYear(), today.getMonth(), 1),
    },
  });
  check(
    "Payments branch filter runs without error",
    true,
    `${paymentCount} Cairo payment(s) this month`,
  );

  const upperBodyId = (
    await Class.findOne({ title: "Strength (Upper Body-Focused)" }).select("_id")
  )?._id;
  if (upperBodyId) {
    const canSchedule = await Class.findById(upperBodyId).select("locations title");
    const locIds = (canSchedule?.locations ?? []).map((id) => id.toString());
    check(
      "Schedule precheck: Upper Body-Focused offered at Cairo",
      locIds.includes(CAIRO_ID),
      `locations=${locIds.join(", ") || "none"}`,
    );

    const existingSession = await ScheduledClass.findOne({
      cid: upperBodyId,
      ...locationIdScalarQuery(CAIRO_ID),
    }).select("_id startTime");
    check(
      "Scheduled sessions query for Upper Body-Focused at Cairo",
      true,
      existingSession
        ? `existing session ${existingSession._id} at ${existingSession.startTime?.toISOString()}`
        : "no sessions yet (scheduling still allowed if class is in catalog)",
    );
  }

  const upperBodyRaw = await db.collection("classes").findOne({
    title: "Strength (Upper Body-Focused)",
  });
  const loc0 = upperBodyRaw?.locations?.[0];
  check(
    "Upper Body-Focused locations[0] storage type",
    loc0 instanceof Types.ObjectId,
    loc0 instanceof Types.ObjectId
      ? "ObjectId (migration applied or created correctly)"
      : `still ${typeof loc0} — run npm run normalize-location-ids:apply`,
  );

  console.log("\n" + "=".repeat(55));
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`Results: ${passed} passed, ${failed} failed, ${checks.length} total`);
  console.log("=".repeat(55));

  if (stringLocCount > 0) {
    console.log(
      "\nNote: API query fix should work before migration. Run normalize-location-ids:apply to clean data.",
    );
  }

  console.log("");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Verification failed:", err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
