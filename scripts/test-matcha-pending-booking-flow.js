#!/usr/bin/env node
/**
 * E2E test: pending member Matcha branch booking flow.
 * Usage: node scripts/test-matcha-pending-booking-flow.js
 */

const { spawn } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { Types } = require("mongoose");

const API = "http://localhost:5000";
const ROOT = path.join(__dirname, "..");
const JWT_SECRET = "e2e-matcha-jwt-secret";
const MATCHA_LOCATION_ID = "6a3e9509c72a8d349f150910";

const results = [];

function log(step, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ""}`);
  results.push({ step, ok, detail });
}

async function request(method, urlPath, { token, body } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${API}/`);
      if (res.ok || res.status === 404) return true;
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

async function seedDatabase(uri) {
  await mongoose.connect(uri);
  const db = mongoose.connection;

  await db.dropDatabase();

  const bcrypt = require("bcryptjs");
  const hashed = await bcrypt.hash("TestPass1!", 10);
  const now = new Date();
  const startTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
  const scheduleDate = startTime.toLocaleDateString();

  const matchaLocId = new Types.ObjectId(MATCHA_LOCATION_ID);
  const otherLocId = new Types.ObjectId();

  await db.collection("locations").insertMany([
    {
      _id: matchaLocId,
      branchName: "Matcha",
      location: "Matcha North Coast",
      locationUrl: "",
    },
    {
      _id: otherLocId,
      branchName: "The Mind Space",
      location: "New Cairo",
      locationUrl: "https://example.com",
    },
  ]);

  const coachInsert = await db.collection("coaches").insertOne({
    name: "E2E Coach",
    email: "coach@test.com",
    phoneNumber: "01000000001",
    createdAt: now,
    updatedAt: now,
  });
  const coachId = coachInsert.insertedId;

  const classInsert = await db.collection("classes").insertOne({
    title: "Matcha Studio E2E",
    category: "STUDIO",
    price: 500,
    locations: [matchaLocId, otherLocId],
    points: 1,
    allowDropIn: true,
    createdAt: now,
    updatedAt: now,
  });
  const classId = classInsert.insertedId;

  const matchaPkgInsert = await db.collection("packages").insertOne({
    name: "Matcha 5 Studio",
    numberOfSessions: 5,
    category: "STUDIO",
    price: 2250,
    expiryPeriod: 30,
    locationId: matchaLocId,
    opensClasses: [classId],
    hidden: false,
    createdAt: now,
    updatedAt: now,
  });

  const otherPkgInsert = await db.collection("packages").insertOne({
    name: "Mind Space 5 Studio",
    numberOfSessions: 5,
    category: "STUDIO",
    price: 2250,
    expiryPeriod: 30,
    locationId: otherLocId,
    opensClasses: [classId],
    hidden: false,
    createdAt: now,
    updatedAt: now,
  });

  const matchaScInsert = await db.collection("scheduledclasses").insertOne({
    cid: classId,
    locationId: matchaLocId,
    startTime,
    endTime,
    availableSlots: 10,
    bookedMembers: [],
    coachId: [coachId],
    scans: [],
    waitlistedMembers: [],
    waitingList: [],
    createdAt: now,
    updatedAt: now,
  });

  const otherScInsert = await db.collection("scheduledclasses").insertOne({
    cid: classId,
    locationId: otherLocId,
    startTime: new Date(startTime.getTime() + 60 * 60 * 1000),
    endTime: new Date(endTime.getTime() + 60 * 60 * 1000),
    availableSlots: 10,
    bookedMembers: [],
    coachId: [coachId],
    scans: [],
    waitlistedMembers: [],
    waitingList: [],
    createdAt: now,
    updatedAt: now,
  });

  const fullScInsert = await db.collection("scheduledclasses").insertOne({
    cid: classId,
    locationId: matchaLocId,
    startTime: new Date(startTime.getTime() + 2 * 60 * 60 * 1000),
    endTime: new Date(endTime.getTime() + 2 * 60 * 60 * 1000),
    availableSlots: 0,
    bookedMembers: [],
    coachId: [coachId],
    scans: [],
    waitlistedMembers: [],
    waitingList: [],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("schedules").deleteMany({});

  const Schedule = require(path.join(ROOT, "dist/models/schedule")).default;
  await Schedule.findOneAndUpdate(
    { date: scheduleDate },
    {
      $set: {
        classes: [
          matchaScInsert.insertedId,
          otherScInsert.insertedId,
          fullScInsert.insertedId,
        ],
      },
    },
    { upsert: true },
  );

  await mongoose.disconnect();

  return {
    matchaPkgId: matchaPkgInsert.insertedId.toString(),
    otherPkgId: otherPkgInsert.insertedId.toString(),
    matchaScid: matchaScInsert.insertedId.toString(),
    otherScid: otherScInsert.insertedId.toString(),
    fullMatchaScid: fullScInsert.insertedId.toString(),
    scheduleDate,
    matchaLocId: matchaLocId.toString(),
  };
}

async function attachPackageToMember(uri, uid, pkgId, locationId) {
  await mongoose.connect(uri);
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const pkg = await mongoose.connection.collection("packages").findOne({
    _id: new Types.ObjectId(pkgId),
  });

  await mongoose.connection.collection("members").updateOne(
    { uid: new Types.ObjectId(uid) },
    {
      $setOnInsert: {
        uid: new Types.ObjectId(uid),
        bookings: [],
        attendance: [],
        ptAttendance: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      $set: {
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            name: pkg.name,
            pkgStartDate: now,
            pkgEndDate: end,
            status: "ACTIVE",
            remainingClasses: pkg.numberOfSessions,
            locationId: new Types.ObjectId(locationId),
          },
        ],
      },
    },
    { upsert: true },
  );
  await mongoose.disconnect();
}

async function countMembers(uri, uid) {
  await mongoose.connect(uri);
  const count = await mongoose.connection.collection("members").countDocuments({
    uid: new Types.ObjectId(uid),
  });
  await mongoose.disconnect();
  return count;
}

async function runFlow(uri, seeded) {
  const testPhone = `0177${Date.now().toString().slice(-7)}`;
  const registerRes = await request("POST", "/auth/register", {
    body: {
      name: "Matcha Pending User",
      email: `matcha.pending.${Date.now()}@test.com`,
      password: "TestPass1!",
      phoneNumber: testPhone,
      role: "user",
    },
  });
  const pendingUserId = registerRes.data?.data?.user?._id;
  const pendingToken = registerRes.data?.data?.token;
  log(
    "Register pending user",
    registerRes.status === 200 && !!pendingToken,
    `id=${pendingUserId || "n/a"}`,
  );
  if (!pendingToken) return;

  const auth = { token: pendingToken };

  const packagesRes = await request(
    "GET",
    `/member/packages?category=STUDIO`,
    auth,
  );
  const packages = packagesRes.data?.data || [];
  const onlyMatcha =
    packages.length > 0 &&
    packages.every((p) => p.locationId === seeded.matchaLocId) &&
    !packages.some((p) => p._id === seeded.otherPkgId);
  log(
    "Pending user lists Matcha packages only",
    packagesRes.status === 200 && onlyMatcha,
    `count=${packages.length}`,
  );

  const scheduleRes = await request(
    "GET",
    `/member/schedule?date=${encodeURIComponent(seeded.scheduleDate)}`,
    auth,
  );
  const sessions = scheduleRes.data?.data || [];
  const onlyMatchaSessions =
    scheduleRes.status === 200 &&
    sessions.length > 0 &&
    sessions.every(
      (s) =>
        (s.sessionBranchName || s.locationId?.branchName || "").toLowerCase() ===
        "matcha",
    );
  log(
    "Pending user schedule scoped to Matcha",
    onlyMatchaSessions,
    `status=${scheduleRes.status} sessions=${sessions.length} date=${seeded.scheduleDate}`,
  );

  const blockOtherRes = await request(
    "POST",
    `/member/book/${seeded.otherScid}`,
    auth,
  );
  log(
    "Block booking non-Matcha session",
    blockOtherRes.status === 403,
    `status=${blockOtherRes.status} error=${blockOtherRes.data?.error || ""}`,
  );

  const blockOtherPkgRes = await request("POST", "/member/packages", {
    ...auth,
    body: { pkgId: seeded.otherPkgId, merchantReferenceId: "fake-ref" },
  });
  log(
    "Block purchasing non-Matcha package",
    blockOtherPkgRes.status === 403,
    `status=${blockOtherPkgRes.status} error=${blockOtherPkgRes.data?.error || ""}`,
  );

  const bookNoPkgRes = await request(
    "POST",
    `/member/book/${seeded.matchaScid}`,
    auth,
  );
  const lazyMemberCreated = (await countMembers(uri, pendingUserId)) === 1;
  log(
    "Lazy Member created on first Matcha book attempt",
    lazyMemberCreated,
    `bookStatus=${bookNoPkgRes.status}`,
  );

  await attachPackageToMember(
    uri,
    pendingUserId,
    seeded.matchaPkgId,
    seeded.matchaLocId,
  );

  const memberPkgsRes = await request("GET", "/member/member-packages", auth);
  const memberPkgs = memberPkgsRes.data?.data || [];
  log(
    "Pending user sees owned Matcha package",
    memberPkgsRes.status === 200 && memberPkgs.length > 0,
    `packages=${memberPkgs.length}`,
  );

  const bookMatchaRes = await request(
    "POST",
    `/member/book/${seeded.matchaScid}`,
    auth,
  );
  log(
    "Book Matcha session with package",
    bookMatchaRes.status === 200,
    bookMatchaRes.data?.message || bookMatchaRes.data?.error || `status=${bookMatchaRes.status}`,
  );

  const bookingsRes = await request("GET", "/member/classes", auth);
  const bookings = bookingsRes.data?.data || [];
  log(
    "Booking appears in member classes",
    bookingsRes.status === 200 && bookings.length > 0,
    `bookings=${bookings.length}`,
  );

  const blockWaitlistOther = await request("POST", "/member/subToWaitingList", {
    ...auth,
    body: { scid: seeded.otherScid, fcmToken: "test-fcm-token" },
  });
  log(
    "Block waitlist on non-Matcha session",
    blockWaitlistOther.status === 403,
    `status=${blockWaitlistOther.status} error=${blockWaitlistOther.data?.error || ""}`,
  );

  const waitlistMatchaRes = await request("POST", "/member/subToWaitingList", {
    ...auth,
    body: { scid: seeded.fullMatchaScid, fcmToken: "test-fcm-token" },
  });
  log(
    "Join waitlist on full Matcha session",
    waitlistMatchaRes.status === 200,
    waitlistMatchaRes.data?.message || waitlistMatchaRes.data?.error || `status=${waitlistMatchaRes.status}`,
  );

  const profileRes = await request("GET", "/member/profile", auth);
  const profile = profileRes.data?.data;
  log(
    "Pending user profile still accessible",
    profileRes.status === 200 && profile?.packages?.length > 0,
    `role=${profile?.uid?.role || "user"}`,
  );
}

async function main() {
  console.log("\n=== Matcha pending member booking E2E ===\n");

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  const serverEnv = {
    ...process.env,
    MONGO_URI: uri,
    JWT_SECRET,
    PORT: "5000",
    NODE_ENV: "testing",
    ENVIRONMENT: "testing",
    MATCHA_BRANCH_NAME: "Matcha",
    MATCHA_LOCATION_ID,
    GEIDEA_URL: "http://127.0.0.1:9",
    GEIDEA_API_PASSWORD: "test",
    GEIDEA_MERCHANT_KEY: "test",
  };

  let server;
  try {
    await new Promise((resolve, reject) => {
      const build = spawn("npx", ["tsc", "-p", "tsconfig.json"], {
        cwd: ROOT,
        stdio: "inherit",
        env: serverEnv,
      });
      build.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tsc failed: ${code}`)),
      );
    });

    const seeded = await seedDatabase(uri);

    server = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ready = await waitForServer();
    if (!ready) {
      console.error("Server did not start in time");
      process.exit(1);
    }

    await runFlow(uri, seeded);
  } finally {
    if (server) server.kill();
    await mongod.stop();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${"=".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`${"=".repeat(55)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
