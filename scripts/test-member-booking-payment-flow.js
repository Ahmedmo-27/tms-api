#!/usr/bin/env node
/**
 * E2E: mobile member booking + APP package purchase + drop-in payments
 * with a local Geidea stub (no real charges).
 *
 * Usage: node scripts/test-member-booking-payment-flow.js
 *    or: npm run test:member-payment-flow
 */

const { spawn } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { Types } = require("mongoose");

const {
  ROOT,
  JWT_SECRET,
  createLogger,
  makeRequest,
  waitForServer,
  compileTypeScript,
  queryDb,
  startGeideaStub,
  uniquePhone,
} = require("./lib/e2e-harness");

const PORT = 5055;
const API = `http://localhost:${PORT}`;
const MATCHA_LOCATION_ID = "6a3e9509c72a8d349f150910";
const PKG_PRICE = 2250;
const DROPIN_PRICE = 500;

async function seedDatabase(uri, mainLocationId) {
  await mongoose.connect(uri);
  const db = mongoose.connection;
  await db.dropDatabase();

  const now = new Date();
  const startTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
  const scheduleDate = startTime.toLocaleDateString();
  // Far-future empty day (no schedule doc)
  const emptyDay = new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const matchaLocId = new Types.ObjectId(MATCHA_LOCATION_ID);
  const mainLocId = new Types.ObjectId(mainLocationId);

  await db.collection("locations").insertMany([
    {
      _id: matchaLocId,
      branchName: "Matcha",
      location: "Matcha North Coast",
      locationUrl: "",
    },
    {
      _id: mainLocId,
      branchName: "The Mind Space",
      location: "New Cairo",
      locationUrl: "https://example.com",
    },
  ]);

  const coachInsert = await db.collection("coaches").insertOne({
    name: "Payment Flow Coach",
    email: "coach.payment.e2e@test.com",
    phoneNumber: "01000000991",
    createdAt: now,
    updatedAt: now,
  });
  const coachId = coachInsert.insertedId;

  const classInsert = await db.collection("classes").insertOne({
    title: "Studio Payment E2E",
    category: "STUDIO",
    price: DROPIN_PRICE,
    locations: [matchaLocId, mainLocId],
    points: 1,
    allowDropIn: true,
    createdAt: now,
    updatedAt: now,
  });
  const classId = classInsert.insertedId;

  const matchaPkg = await db.collection("packages").insertOne({
    name: "Matcha Studio 5 E2E",
    numberOfSessions: 5,
    category: "STUDIO",
    price: PKG_PRICE,
    expiryPeriod: 30,
    locationId: matchaLocId,
    opensClasses: [classId],
    hidden: false,
    createdAt: now,
    updatedAt: now,
  });

  // Visible only to non-pending / catalog listings that aren't Matcha-filtered
  await db.collection("packages").insertOne({
    name: "Mind Space Studio 5 E2E",
    numberOfSessions: 5,
    category: "STUDIO",
    price: PKG_PRICE,
    expiryPeriod: 30,
    locationId: mainLocId,
    opensClasses: [classId],
    hidden: false,
    createdAt: now,
    updatedAt: now,
  });

  const bookableSc = await db.collection("scheduledclasses").insertOne({
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

  // Legacy session: no locationId — class.locations still has Matcha first.
  // Pending (role=user) cannot book this; role=member can, for location fallback.
  const legacyDropInSc = await db.collection("scheduledclasses").insertOne({
    cid: classId,
    startTime: new Date(startTime.getTime() + 2 * 60 * 60 * 1000),
    endTime: new Date(endTime.getTime() + 2 * 60 * 60 * 1000),
    availableSlots: 10,
    bookedMembers: [],
    coachId: [coachId],
    scans: [],
    waitlistedMembers: [],
    waitingList: [],
    createdAt: now,
    updatedAt: now,
  });

  const concurrentSc = await db.collection("scheduledclasses").insertOne({
    cid: classId,
    locationId: matchaLocId,
    startTime: new Date(startTime.getTime() + 3 * 60 * 60 * 1000),
    endTime: new Date(endTime.getTime() + 3 * 60 * 60 * 1000),
    availableSlots: 2,
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
          bookableSc.insertedId,
          legacyDropInSc.insertedId,
          concurrentSc.insertedId,
        ],
      },
    },
    { upsert: true },
  );

  await mongoose.disconnect();

  return {
    matchaPkgId: matchaPkg.insertedId.toString(),
    bookableScid: bookableSc.insertedId.toString(),
    legacyDropInScid: legacyDropInSc.insertedId.toString(),
    concurrentScid: concurrentSc.insertedId.toString(),
    scheduleDate,
    emptyDay,
    matchaLocId: matchaLocId.toString(),
    mainLocId: mainLocId.toString(),
    classId: classId.toString(),
  };
}

async function registerUser(request, log, label) {
  const phone = uniquePhone("015");
  const res = await request("POST", "/auth/register", {
    body: {
      name: `Payment E2E ${label}`,
      email: `payment.e2e.${label}.${Date.now()}@test.com`,
      password: "TestPass1!",
      phoneNumber: phone,
      role: "user",
    },
  });
  const token = res.data?.data?.token;
  const userId = res.data?.data?.user?._id;
  log(
    `Register ${label}`,
    res.status === 200 && !!token && !!userId,
    `status=${res.status} id=${userId || "n/a"}`,
  );
  return { token, userId, phone };
}

async function attachPackageDirect(uri, uid, pkgId, locationId, sessions = 5) {
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
            remainingClasses: sessions,
            locationId: new Types.ObjectId(locationId),
          },
        ],
      },
    },
    { upsert: true },
  );
  await mongoose.disconnect();
}

async function promoteToMemberRole(uri, userId) {
  await mongoose.connect(uri);
  await mongoose.connection.collection("users").updateOne(
    { _id: new Types.ObjectId(userId) },
    { $set: { role: "member" } },
  );
  await mongoose.disconnect();
}

async function runFlow({ uri, seeded, request, log, geidea }) {
  const userA = await registerUser(request, log, "A");
  if (!userA.token) return;
  const authA = { token: userA.token };

  // ── List packages (pending → Matcha only) ──
  const packagesRes = await request("GET", "/member/packages", authA);
  const packages = packagesRes.data?.data || [];
  const hasMatchaPkg = packages.some((p) => p._id === seeded.matchaPkgId);
  log(
    "List packages",
    packagesRes.status === 200 && packages.length > 0 && hasMatchaPkg,
    `status=${packagesRes.status} count=${packages.length}`,
  );

  // ── APP subscribe ──
  const pkgRef = `pkg-${seeded.matchaPkgId}-${userA.userId.slice(-4)}`;
  geidea.setAmount(pkgRef, PKG_PRICE);
  const subRes = await request("POST", "/member/packages", {
    ...authA,
    body: { pkgId: seeded.matchaPkgId, merchantReferenceId: pkgRef },
  });
  log(
    "APP subscribe package",
    subRes.status === 200,
    subRes.data?.message || subRes.data?.code || `status=${subRes.status}`,
  );

  const packagePayment = await queryDb(uri, async (db) =>
    db.collection("payments").findOne({
      merchantReferenceId: pkgRef,
      purpose: "PACKAGE",
    }),
  );
  log(
    "Package payment has locationId",
    !!packagePayment?.locationId &&
      packagePayment.locationId.toString() === seeded.matchaLocId,
    `locationId=${packagePayment?.locationId || "missing"}`,
  );

  const memberAfterSub = await queryDb(uri, async (db) =>
    db.collection("members").findOne({ uid: new Types.ObjectId(userA.userId) }),
  );
  const activePkg = (memberAfterSub?.packages || []).find(
    (p) => p.pkgId.toString() === seeded.matchaPkgId && p.status === "ACTIVE",
  );
  log(
    "Member has ACTIVE package",
    !!activePkg && activePkg.remainingClasses === 5,
    `remaining=${activePkg?.remainingClasses ?? "n/a"}`,
  );

  // ── Empty schedule day → 200 + [] ──
  const emptyRes = await request(
    "GET",
    `/member/schedule?date=${encodeURIComponent(seeded.emptyDay)}`,
    authA,
  );
  const emptyOk =
    emptyRes.status === 200 &&
    Array.isArray(emptyRes.data?.data) &&
    emptyRes.data.data.length === 0 &&
    emptyRes.data?.code !== "CLASSES_NOT_FOUND";
  log(
    "Empty schedule returns 200 []",
    emptyOk,
    `status=${emptyRes.status} code=${emptyRes.data?.code} len=${emptyRes.data?.data?.length}`,
  );

  // ── Schedule with classes ──
  const scheduleRes = await request(
    "GET",
    `/member/schedule?date=${encodeURIComponent(seeded.scheduleDate)}`,
    authA,
  );
  const sessions = scheduleRes.data?.data || [];
  const bookableSession = sessions.find((s) => s._id === seeded.bookableScid);
  log(
    "Schedule with classes",
    scheduleRes.status === 200 && sessions.length > 0 && !!bookableSession,
    `status=${scheduleRes.status} count=${sessions.length}`,
  );
  log(
    "Session shaped with location fields",
    !!bookableSession &&
      (!!bookableSession.locationId || !!bookableSession.sessionBranchName),
    `branch=${bookableSession?.sessionBranchName || "n/a"}`,
  );

  // ── Book with package ──
  const bookRes = await request(
    "POST",
    `/member/book/${seeded.bookableScid}`,
    { ...authA, body: {} },
  );
  log(
    "Book class with package",
    bookRes.status === 200,
    bookRes.data?.message || bookRes.data?.code || `status=${bookRes.status}`,
  );

  const memberAfterBook = await queryDb(uri, async (db) =>
    db.collection("members").findOne({ uid: new Types.ObjectId(userA.userId) }),
  );
  const pkgAfterBook = (memberAfterBook?.packages || []).find(
    (p) => p.pkgId.toString() === seeded.matchaPkgId,
  );
  log(
    "Remaining classes decremented",
    pkgAfterBook?.remainingClasses === 4,
    `remaining=${pkgAfterBook?.remainingClasses ?? "n/a"}`,
  );

  // ── Cancel booking ──
  const cancelRes = await request(
    "DELETE",
    `/member/cancel/${seeded.bookableScid}`,
    authA,
  );
  log(
    "Cancel booking",
    cancelRes.status === 200,
    cancelRes.data?.message ||
      cancelRes.data?.code ||
      `status=${cancelRes.status}`,
  );

  // ── Drop-in on Matcha session (with locationId) ──
  const dropRef = `drop-${seeded.bookableScid}-${userA.userId.slice(-4)}`;
  geidea.setAmount(dropRef, DROPIN_PRICE);
  const dropRes = await request("POST", "/member/dropIn", {
    ...authA,
    body: { scid: seeded.bookableScid, merchantReferenceId: dropRef },
  });
  log(
    "Drop-in with session locationId",
    dropRes.status === 200,
    dropRes.data?.message || dropRes.data?.code || `status=${dropRes.status}`,
  );

  const dropPayment = await queryDb(uri, async (db) =>
    db.collection("payments").findOne({
      merchantReferenceId: dropRef,
      purpose: "DROPIN",
    }),
  );
  log(
    "Drop-in payment has locationId",
    !!dropPayment?.locationId &&
      dropPayment.locationId.toString() === seeded.matchaLocId,
    `locationId=${dropPayment?.locationId || "missing"}`,
  );

  // Cancel drop-in so we can reuse flows cleanly
  const cancelDropRes = await request(
    "POST",
    `/member/cancel-dropin/${seeded.bookableScid}`,
    authA,
  );
  log(
    "Cancel drop-in",
    cancelDropRes.status === 200 || cancelDropRes.status === 404,
    `status=${cancelDropRes.status} code=${cancelDropRes.data?.code}`,
  );

  // ── Bad payment ref ──
  const badDrop = await request("POST", "/member/dropIn", {
    ...authA,
    body: {
      scid: seeded.bookableScid,
      merchantReferenceId: "unknown-ref-never-paid",
    },
  });
  log(
    "Bad payment ref rejected",
    badDrop.status >= 400 &&
      (badDrop.data?.code === "INVALID_PAYMENT" ||
        badDrop.data?.message?.toLowerCase?.().includes("payment")),
    `status=${badDrop.status} code=${badDrop.data?.code}`,
  );

  // ── Legacy drop-in (no session locationId) as role=member ──
  await promoteToMemberRole(uri, userA.userId);
  // Re-login so JWT carries role=member (token may embed role)
  const loginRes = await request("POST", "/auth/login", {
    body: { phoneNumber: userA.phone, password: "TestPass1!" },
  });
  const memberToken = loginRes.data?.data?.token || userA.token;
  const authMember = { token: memberToken };
  log(
    "Re-login as member role",
    loginRes.status === 200 && !!memberToken,
    `status=${loginRes.status}`,
  );

  const legacyRef = `legacy-drop-${seeded.legacyDropInScid}`;
  geidea.setAmount(legacyRef, DROPIN_PRICE);
  const legacyDrop = await request("POST", "/member/dropIn", {
    ...authMember,
    body: {
      scid: seeded.legacyDropInScid,
      merchantReferenceId: legacyRef,
    },
  });
  log(
    "Drop-in without session locationId",
    legacyDrop.status === 200,
    legacyDrop.data?.message ||
      legacyDrop.data?.code ||
      `status=${legacyDrop.status}`,
  );

  const legacyPayment = await queryDb(uri, async (db) =>
    db.collection("payments").findOne({
      merchantReferenceId: legacyRef,
      purpose: "DROPIN",
    }),
  );
  log(
    "Legacy drop-in resolved locationId",
    !!legacyPayment?.locationId,
    `locationId=${legacyPayment?.locationId || "missing"}`,
  );

  // ── Concurrent book smoke ──
  const userB = await registerUser(request, log, "B");
  if (!userB.token) return;
  await attachPackageDirect(
    uri,
    userB.userId,
    seeded.matchaPkgId,
    seeded.matchaLocId,
    5,
  );
  // Refresh remaining classes for user A after cancels — attach fresh package credits
  await attachPackageDirect(
    uri,
    userA.userId,
    seeded.matchaPkgId,
    seeded.matchaLocId,
    5,
  );

  const [r1, r2] = await Promise.all([
    request("POST", `/member/book/${seeded.concurrentScid}`, {
      ...authMember,
      body: {},
    }),
    request("POST", `/member/book/${seeded.concurrentScid}`, {
      token: userB.token,
      body: {},
    }),
  ]);
  const codes = [r1.data?.code, r2.data?.code].filter(Boolean);
  const statuses = [r1.status, r2.status];
  const bothInternal =
    codes.includes("INTERNAL_ERROR") ||
    `${r1.data?.message || ""}${r2.data?.message || ""}`
      .toLowerCase()
      .includes("write conflict");
  const successCount = statuses.filter((s) => s === 200).length;
  const conflictOk =
    successCount >= 1 &&
    !bothInternal &&
    (successCount === 2 ||
      codes.some((c) =>
        [
          "CLASS_ALREADY_BOOKED",
          "CLASS_FULLY_BOOKED",
          "NO_ACTIVE_PACKAGE_FOUND",
        ].includes(c),
      ) ||
      statuses.some((s) => s === 409 || s === 403 || s === 404));
  log(
    "Concurrent book no WriteConflict",
    conflictOk,
    `statuses=${statuses.join(",")} codes=${codes.join(",") || "none"}`,
  );
}

async function main() {
  console.log("\n=== Member booking + APP payment flow E2E ===\n");
  const { log, summary } = createLogger();
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const mainLocationId = new Types.ObjectId().toString();

  const geidea = await startGeideaStub();
  const request = makeRequest(API);

  const serverEnv = {
    ...process.env,
    MONGO_URI: uri,
    JWT_SECRET,
    PORT: String(PORT),
    NODE_ENV: "testing",
    ENVIRONMENT: "testing",
    MATCHA_BRANCH_NAME: "Matcha",
    MATCHA_LOCATION_ID,
    MAIN_LOCATION_ID: mainLocationId,
    MAIN_BRANCH_NAME: "The Mind Space",
    GEIDEA_URL: geidea.baseUrl,
    GEIDEA_API_PASSWORD: "e2e-geidea-pass",
    GEIDEA_MERCHANT_KEY: "e2e-geidea-key",
  };

  let server;
  try {
    await compileTypeScript(serverEnv);
    const seeded = await seedDatabase(uri, mainLocationId);

    server = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ready = await waitForServer(API);
    if (!ready) {
      console.error("Server did not start in time");
      process.exitCode = 1;
      return;
    }

    await runFlow({ uri, seeded, request, log, geidea });
  } finally {
    if (server) server.kill();
    await geidea.close();
    await mongod.stop();
  }

  const { failed } = summary();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
