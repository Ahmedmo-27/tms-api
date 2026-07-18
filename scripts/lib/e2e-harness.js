#!/usr/bin/env node
/**
 * Shared helpers for in-memory Mongo + local API E2E scripts.
 */

const { spawn } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { Types } = require("mongoose");

const ROOT = path.join(__dirname, "../..");
const JWT_SECRET = "e2e-package-flows-jwt";
const ADMIN_PHONE = "01229004551";
const ADMIN_PASSWORD = "01229004551";

const PACKAGE_CATEGORIES = [
  "FUNCTIONAL_TRAINING",
  "STUDIO",
  "PERSONAL_TRAINING",
  "PRE_POST_NATAL",
  "MIXED",
  "SPACE_MEMBERSHIP",
  "ULTIMATE_MINDSPACER",
  "OPEN_GYM",
];

function createLogger() {
  const results = [];
  function log(step, ok, detail = "") {
    const status = ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ""}`);
    results.push({ step, ok, detail });
  }
  function summary() {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${"=".repeat(55)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
    console.log(`${"=".repeat(55)}\n`);
    return { passed, failed, results };
  }
  return { log, summary, results };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRequest(apiBase) {
  return async function request(method, urlPath, { token, body } = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${apiBase}${urlPath}`, {
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
  };
}

async function waitForServer(apiBase, maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${apiBase}/`);
      if (res.ok || res.status === 404) return true;
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

async function compileTypeScript(env) {
  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["tsc", "-p", "tsconfig.json"], {
      cwd: ROOT,
      stdio: "inherit",
      env,
    });
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`tsc failed: ${code}`)),
    );
  });
}

async function queryDb(uri, fn) {
  await mongoose.connect(uri);
  try {
    return await fn(mongoose.connection);
  } finally {
    await mongoose.disconnect();
  }
}

async function seedBase({
  uri,
  matchaLocationId,
  otherLocationId,
  includeAllCategories = true,
}) {
  await mongoose.connect(uri);
  const db = mongoose.connection;
  await db.dropDatabase();

  const bcrypt = require("bcryptjs");
  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const now = new Date();

  const matchaLocId = new Types.ObjectId(matchaLocationId);
  const otherLocId = new Types.ObjectId(otherLocationId);

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

  const adminInsert = await db.collection("users").insertOne({
    name: "E2E Admin",
    email: "e2e-admin@test.com",
    password: hashed,
    phoneNumber: ADMIN_PHONE,
    role: "admin",
    tokens: [],
    createdAt: now,
    updatedAt: now,
  });

  const coachInsert = await db.collection("coaches").insertOne({
    name: "E2E Coach",
    email: "coach-e2e@test.com",
    phoneNumber: "01000000001",
    createdAt: now,
    updatedAt: now,
  });

  const packagesByCategory = {};

  if (includeAllCategories) {
    const defs = [
      {
        category: "FUNCTIONAL_TRAINING",
        name: "FT 8 Pack",
        numberOfSessions: 8,
        price: 1800,
        expiryPeriod: 45,
      },
      {
        category: "STUDIO",
        name: "Studio 5 Pack",
        numberOfSessions: 5,
        price: 2250,
        expiryPeriod: 30,
      },
      {
        category: "PERSONAL_TRAINING",
        name: "PT 10 Sessions",
        numberOfSessions: 10,
        price: 5000,
        expiryPeriod: 60,
        coachId: coachInsert.insertedId,
      },
      {
        category: "PRE_POST_NATAL",
        name: "Pre/Post Natal 6",
        numberOfSessions: 6,
        price: 2400,
        expiryPeriod: 40,
      },
      {
        category: "MIXED",
        name: "Spacer Mix",
        numberOfSessions: 8,
        price: 3500,
        expiryPeriod: 30,
      },
      {
        category: "SPACE_MEMBERSHIP",
        name: "Space membership",
        numberOfSessions: 10000,
        price: 2750,
        expiryPeriod: 30,
      },
      {
        category: "ULTIMATE_MINDSPACER",
        name: "Ultimate Mindspacer",
        numberOfSessions: 10000,
        price: 4500,
        expiryPeriod: 30,
      },
      {
        category: "OPEN_GYM",
        name: "Open Gym Matcha 30d",
        numberOfSessions: 10000,
        price: 1500,
        expiryPeriod: 30,
        locationId: matchaLocId,
      },
    ];

    for (const def of defs) {
      const insert = await db.collection("packages").insertOne({
        ...def,
        opensClasses: [],
        hidden: false,
        createdAt: now,
        updatedAt: now,
      });
      packagesByCategory[def.category] = insert.insertedId.toString();
    }

    // Second OPEN_GYM bound to the other branch for mismatch tests
    const otherOpenGym = await db.collection("packages").insertOne({
      name: "Open Gym Mind Space 30d",
      numberOfSessions: 10000,
      category: "OPEN_GYM",
      price: 1500,
      expiryPeriod: 30,
      locationId: otherLocId,
      opensClasses: [],
      hidden: false,
      createdAt: now,
      updatedAt: now,
    });
    packagesByCategory.OPEN_GYM_OTHER = otherOpenGym.insertedId.toString();

    // Matcha-bound STUDIO for pending-branch rules
    const matchaStudio = await db.collection("packages").insertOne({
      name: "Matcha Studio 5",
      numberOfSessions: 5,
      category: "STUDIO",
      price: 2250,
      expiryPeriod: 30,
      locationId: matchaLocId,
      opensClasses: [],
      hidden: false,
      createdAt: now,
      updatedAt: now,
    });
    packagesByCategory.STUDIO_MATCHA = matchaStudio.insertedId.toString();

    const otherStudio = await db.collection("packages").insertOne({
      name: "Mind Space Studio 5",
      numberOfSessions: 5,
      category: "STUDIO",
      price: 2250,
      expiryPeriod: 30,
      locationId: otherLocId,
      opensClasses: [],
      hidden: false,
      createdAt: now,
      updatedAt: now,
    });
    packagesByCategory.STUDIO_OTHER = otherStudio.insertedId.toString();
  }

  await mongoose.disconnect();

  return {
    adminId: adminInsert.insertedId.toString(),
    coachId: coachInsert.insertedId.toString(),
    matchaLocationId: matchaLocId.toString(),
    otherLocationId: otherLocId.toString(),
    packagesByCategory,
  };
}

async function runWithServer({
  title,
  port,
  extraEnv = {},
  matchaLocationId = "6a3e9509c72a8d349f150910",
  otherLocationId,
  seed = seedBase,
  run,
}) {
  console.log(`\n=== ${title} ===\n`);
  const { log, summary } = createLogger();
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const apiBase = `http://localhost:${port}`;
  const request = makeRequest(apiBase);

  const otherLoc =
    otherLocationId || new Types.ObjectId().toString();

  const serverEnv = {
    ...process.env,
    MONGO_URI: uri,
    JWT_SECRET,
    PORT: String(port),
    NODE_ENV: "testing",
    ENVIRONMENT: "testing",
    MATCHA_BRANCH_NAME: "Matcha",
    MATCHA_LOCATION_ID: matchaLocationId,
    GEIDEA_URL: "http://127.0.0.1:9",
    GEIDEA_API_PASSWORD: "test",
    GEIDEA_MERCHANT_KEY: "test",
    ...extraEnv,
  };

  let server;
  try {
    await compileTypeScript(serverEnv);
    const seeded = await seed({
      uri,
      matchaLocationId,
      otherLocationId: otherLoc,
      includeAllCategories: true,
    });

    server = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ready = await waitForServer(apiBase);
    if (!ready) {
      console.error("Server did not start in time");
      process.exitCode = 1;
      return;
    }

    await run({
      uri,
      seeded,
      request,
      log,
      queryDb: (fn) => queryDb(uri, fn),
      apiBase,
    });
  } finally {
    if (server) server.kill();
    await mongod.stop();
  }

  const { failed } = summary();
  if (failed > 0) process.exit(1);
}

async function loginAdmin(request, log) {
  const loginRes = await request("POST", "/auth/login", {
    body: { phoneNumber: ADMIN_PHONE, password: ADMIN_PASSWORD },
  });
  const token = loginRes.data?.data?.token;
  log(
    "Admin login",
    loginRes.status === 200 && !!token,
    `status=${loginRes.status}`,
  );
  return token;
}

function uniquePhone(prefix = "019") {
  return `${prefix}${Date.now().toString().slice(-8)}`.slice(0, 11);
}

function todayDateOnly() {
  return new Date().toISOString().split("T")[0];
}

module.exports = {
  ROOT,
  JWT_SECRET,
  ADMIN_PHONE,
  ADMIN_PASSWORD,
  PACKAGE_CATEGORIES,
  createLogger,
  makeRequest,
  waitForServer,
  compileTypeScript,
  queryDb,
  seedBase,
  runWithServer,
  loginAdmin,
  uniquePhone,
  todayDateOnly,
};
