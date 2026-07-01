#!/usr/bin/env node
/**
 * End-to-end walk-in package flow:
 * guest purchase → pending user → full member
 *
 * Usage: node scripts/test-walk-in-full-flow.js
 * (Starts in-memory MongoDB + API server automatically)
 */

const { spawn } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const API = "http://localhost:5000";
const ROOT = path.join(__dirname, "..");
const JWT_SECRET = "e2e-test-jwt-secret";
const ADMIN_PHONE = "01229004551";
const ADMIN_PASSWORD = "01229004551";

const results = [];

function log(step, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
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
  const users = mongoose.connection.collection("users");
  const packages = mongoose.connection.collection("packages");

  await users.deleteMany({});
  await packages.deleteMany({});
  await mongoose.connection.collection("nonuserpackages").deleteMany({});
  await mongoose.connection.collection("payments").deleteMany({});
  await mongoose.connection.collection("members").deleteMany({});

  const bcrypt = require("bcryptjs");
  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const adminInsert = await users.insertOne({
    name: "E2E Admin",
    email: "e2e-admin@test.com",
    password: hashed,
    phoneNumber: ADMIN_PHONE,
    role: "admin",
    tokens: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const pkgInsert = await packages.insertOne({
    name: "5 Studio E2E",
    numberOfSessions: 5,
    category: "STUDIO",
    price: 2250,
    expiryPeriod: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await mongoose.disconnect();
  return {
    adminId: adminInsert.insertedId.toString(),
    pkgId: pkgInsert.insertedId.toString(),
  };
}

async function queryDb(uri, fn) {
  await mongoose.connect(uri);
  try {
    return await fn(mongoose.connection);
  } finally {
    await mongoose.disconnect();
  }
}

async function runFlow(uri, seeded) {
  const loginRes = await request("POST", "/auth/login", {
    body: { phoneNumber: ADMIN_PHONE, password: ADMIN_PASSWORD },
  });
  const adminToken = loginRes.data?.data?.token;
  log(
    "Admin login",
    loginRes.status === 200 && !!adminToken,
    `status=${loginRes.status}`
  );
  if (!adminToken) return;

  const auth = { token: adminToken };
  const walkInPhone = `0199${Date.now().toString().slice(-7)}`;
  const walkInName = "Walk In Client";
  const startDate = new Date().toISOString().split("T")[0];

  // ── Stage 1: Walk-in guest package purchase (no user account) ──
  const guestPkgRes = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: walkInName,
      phoneNumber: walkInPhone,
      pkgId: seeded.pkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      amount: "2250",
    },
  });
  log(
    "Walk-in: create non-user package",
    guestPkgRes.status === 200,
    guestPkgRes.data?.message || guestPkgRes.data?.error || `status=${guestPkgRes.status}`
  );

  const stage1 = await queryDb(uri, async (db) => {
    const staged = await db.collection("nonuserpackages").findOne({ phoneNumber: walkInPhone });
    const payment = staged
      ? await db.collection("payments").findOne({ _id: staged.paymentId })
      : null;
    return { staged, payment };
  });

  log(
    "Walk-in: NonUserPackage staged (added=false)",
    !!stage1.staged && stage1.staged.added !== true,
    `remaining=${stage1.staged?.remainingClasses}`
  );
  log(
    "Walk-in: payment recorded as NON_USER_PACKAGE",
    stage1.payment?.purpose === "NON_USER_PACKAGE",
    `amount=${stage1.payment?.amount} method=${stage1.payment?.paymentMethod}`
  );
  log(
    "Walk-in: payment has guest name/phone, no uid",
    stage1.payment?.nonMemberName === walkInName &&
      stage1.payment?.nonMemberPhone === walkInPhone &&
      !stage1.payment?.uid,
    `name=${stage1.payment?.nonMemberName}`
  );
  log(
    "Walk-in: payment linked to package template",
    stage1.payment?.pkgId?.toString() === seeded.pkgId,
    `pkgId=${stage1.payment?.pkgId}`
  );

  const guestListRes = await request("GET", `/admin/nonUserPackage?phoneNumber=${walkInPhone}`, auth);
  log(
    "Walk-in: listed in non-user packages",
    guestListRes.status === 200 && (guestListRes.data?.data?.length || 0) > 0,
    `count=${guestListRes.data?.data?.length || 0}`
  );

  // ── Stage 2: Client registers in app (pending / non-member) ──
  const registerRes = await request("POST", "/auth/register", {
    body: {
      name: walkInName,
      email: `walkin.${walkInPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: walkInPhone,
      role: "user",
    },
  });
  const pendingUserId = registerRes.data?.data?.user?._id;
  log(
    "Pending: register as role=user",
    registerRes.status === 200 && !!pendingUserId,
    `id=${pendingUserId || "n/a"}`
  );

  const pendingRes = await request(
    "GET",
    `/admin/pending-members?page=1&limit=50&phone=${walkInPhone}`,
    auth
  );
  const pendingUser = (pendingRes.data?.data?.users || []).find(
    (u) => u.phoneNumber === walkInPhone
  );
  const pendingPkgCount = pendingUser?.pendingPackages?.length || 0;
  log(
    "Pending: package visible on member request",
    pendingRes.status === 200 && pendingPkgCount > 0,
    `pendingPackages=${pendingPkgCount}`
  );

  const stage2 = await queryDb(uri, async (db) => {
    const staged = await db.collection("nonuserpackages").findOne({ phoneNumber: walkInPhone });
    const user = await db.collection("users").findOne({ phoneNumber: walkInPhone });
    const member = await db.collection("members").findOne({ uid: user?._id });
    return { staged, user, member };
  });

  log(
    "Pending: package still staged (not on member yet)",
    stage2.staged?.added !== true && !stage2.member,
    `role=${stage2.user?.role}`
  );
  log(
    "Pending: payment unchanged (still guest-scoped)",
    stage1.payment?._id?.toString() === stage2.staged?.paymentId?.toString(),
    "paymentId stable"
  );

  // ── Stage 3: Staff accepts → full member ──
  const acceptRes = await request("POST", `/admin/member/${pendingUserId}`, auth);
  log(
    "Member: accept pending user",
    acceptRes.status === 200,
    acceptRes.data?.message || acceptRes.data?.error || `status=${acceptRes.status}`
  );

  const memberRes = await request("GET", `/admin/member?uid=${pendingUserId}`, auth);
  const member = memberRes.data?.data?.members?.[0];
  const memberPackages = member?.packages || [];
  log(
    "Member: package transferred to account",
    memberPackages.length > 0 && memberPackages[0].remainingClasses === 5,
    `packages=${memberPackages.length} remaining=${memberPackages[0]?.remainingClasses}`
  );

  const stage3 = await queryDb(uri, async (db) => {
    const staged = await db.collection("nonuserpackages").findOne({ phoneNumber: walkInPhone });
    const payment = await db.collection("payments").findOne({ _id: staged?.paymentId });
    const user = await db.collection("users").findOne({ phoneNumber: walkInPhone });
    return { staged, payment, user };
  });

  log(
    "Member: NonUserPackage marked added=true",
    stage3.staged?.added === true,
    `added=${stage3.staged?.added}`
  );
  log(
    "Member: user role promoted to member",
    stage3.user?.role === "member",
    `role=${stage3.user?.role}`
  );
  log(
    "Member: payment still shows guest name (uid not backfilled)",
    !stage3.payment?.uid && stage3.payment?.nonMemberName === walkInName,
  "by design — audit trail kept on payment row"
  );

  const consumedListRes = await request(
    "GET",
    `/admin/nonUserPackage?phoneNumber=${walkInPhone}`,
    auth
  );
  log(
    "Member: removed from active non-user package list",
    consumedListRes.status === 404,
    `status=${consumedListRes.status}`
  );

  const paymentsRes = await request("GET", `/admin/payments?page=1&limit=100`, auth);
  const payments = paymentsRes.data?.data?.payments || paymentsRes.data?.data || [];
  const guestPayment = Array.isArray(payments)
    ? payments.find(
        (p) =>
          p.purpose === "NON_USER_PACKAGE" &&
          p.nonMemberPhone === walkInPhone
      )
    : null;
  log(
    "Member: payment visible in admin payments list",
    paymentsRes.status === 200 && !!guestPayment,
    `label=${guestPayment?.paymentLabel || guestPayment?.purpose}`
  );

  // ── Scenario B: register-manually transfers staged packages ──
  const manualPhone = `0188${Date.now().toString().slice(-7)}`;
  await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Manual Register Client",
      phoneNumber: manualPhone,
      pkgId: seeded.pkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    },
  });

  const manualRegRes = await request("POST", "/auth/register-manually", {
    body: {
      name: "Manual Register Client",
      phoneNumber: manualPhone,
      password: "TestPass1!",
    },
  });
  const manualUserId = manualRegRes.data?.data?.user?._id;
  const manualMemberRes = await request("GET", `/admin/member?uid=${manualUserId}`, auth);
  const manualMemberPkgs = manualMemberRes.data?.data?.members?.[0]?.packages || [];
  log(
    "Manual register: staged package transferred immediately",
    manualRegRes.status === 200 && manualMemberPkgs.length > 0,
    `packages=${manualMemberPkgs.length}`
  );

  // ── Scenario C: phone normalization ──
  const spacedPhone = `0177${Date.now().toString().slice(-7)}`;
  const spacedPhoneFormatted = `${spacedPhone.slice(0, 3)} ${spacedPhone.slice(3, 6)} ${spacedPhone.slice(6)}`;
  await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Spaced Phone Client",
      phoneNumber: spacedPhoneFormatted,
      pkgId: seeded.pkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    },
  });

  const normStage = await queryDb(uri, async (db) => {
    return db.collection("nonuserpackages").findOne({ phoneNumber: spacedPhone });
  });
  log(
    "Normalization: spaces stripped on save",
    !!normStage && normStage.phoneNumber === spacedPhone,
    `stored=${normStage?.phoneNumber}`
  );

  const spacedRegRes = await request("POST", "/auth/register", {
    body: {
      name: "Spaced Phone Client",
      email: `spaced.${spacedPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: spacedPhone,
      role: "user",
    },
  });
  const spacedUserId = spacedRegRes.data?.data?.user?._id;
  await request("POST", `/admin/member/${spacedUserId}`, auth);
  const spacedMemberRes = await request("GET", `/admin/member?uid=${spacedUserId}`, auth);
  const spacedPkgs = spacedMemberRes.data?.data?.members?.[0]?.packages || [];
  log(
    "Normalization: package transfers after accept",
    spacedPkgs.length > 0,
    `packages=${spacedPkgs.length}`
  );
}

async function main() {
  console.log("\n=== Walk-in package E2E test ===\n");

  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  const serverEnv = {
    ...process.env,
    MONGO_URI: uri,
    JWT_SECRET,
    PORT: "5000",
    NODE_ENV: "testing",
    ENVIRONMENT: "testing",
  };

  let seeded;
  try {
    // Build once so seed can use compiled models if needed
    await new Promise((resolve, reject) => {
      const build = spawn("npx", ["tsc", "-p", "tsconfig.json"], {
        cwd: ROOT,
        stdio: "inherit",
        env: serverEnv,
      });
      build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tsc failed: ${code}`))));
    });

    seeded = await seedDatabase(uri);

    const server = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    server.stdout.on("data", (d) => {
      const msg = d.toString();
      if (msg.includes("error") || msg.includes("Error")) process.stdout.write(msg);
    });
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ready = await waitForServer();
    if (!ready) {
      console.error("Server did not start in time");
      server.kill();
      process.exit(1);
    }

    await runFlow(uri, seeded);
    server.kill();
  } finally {
    await mongod.stop();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${"=".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`${"=".repeat(55)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
