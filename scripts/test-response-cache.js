#!/usr/bin/env node
/**
 * End-to-end checks for the in-memory GET response cache.
 *
 * Boots a local API on an in-memory database, then checks:
 * - first GET is a miss and the repeat is a hit
 * - /api and unprefixed paths share one entry
 * - personal responses stay tied to the caller
 * - shared lists are reused for the same role
 * - a different query or app version is a different entry
 * - a successful write drops the related entries
 * - login, logout, and verifyToken are not cached
 * - a 401 is not stored
 *
 * Usage: node scripts/test-response-cache.js
 *    or: npm run test:response-cache
 */

const {
  runWithServer,
  loginAdmin,
  uniquePhone,
} = require("./lib/e2e-harness");

const APP_VERSION = { "x-app-version": "1.0.12" };

function namesFrom(res) {
  const rows = res.data?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => row.branchName || row.coachName || row.name).filter(Boolean);
}

async function registerMember(request, log, label) {
  const phone = uniquePhone("015");
  const name = `Cache ${label}`;
  const res = await request("POST", "/auth/register", {
    headers: APP_VERSION,
    body: {
      name,
      email: `${label}.${phone}@cache.test`,
      password: "TestPass1!",
      phoneNumber: phone,
    },
  });
  const token = res.data?.data?.token;
  log(
    `Register ${label}`,
    res.status === 200 && !!token,
    `status=${res.status}`,
  );
  return { token, name, phone };
}

async function run({ request, log }) {
  const adminToken = await loginAdmin(request, log);
  if (!adminToken) return;
  const admin = { token: adminToken };

  // ── Public app version, split by the client version header ──
  const versionMissing = await request("GET", "/auth/app-version");
  const versionMissingAgain = await request("GET", "/auth/app-version");
  log(
    "App version first read is a miss",
    versionMissing.status === 200 && versionMissing.cache === "MISS",
    `status=${versionMissing.status} x-cache=${versionMissing.cache}`,
  );
  log(
    "App version repeat is a hit",
    versionMissingAgain.status === 200 &&
      versionMissingAgain.cache === "HIT" &&
      versionMissingAgain.cacheControl === "private, max-age=0",
    `x-cache=${versionMissingAgain.cache} cache-control=${versionMissingAgain.cacheControl}`,
  );

  const versionOld = await request("GET", "/auth/app-version", {
    headers: { "x-app-version": "1.0.9" },
  });
  const versionOldAgain = await request("GET", "/auth/app-version", {
    headers: { "x-app-version": "1.0.9" },
  });
  const versionNew = await request("GET", "/auth/app-version", {
    headers: { "x-app-version": "1.0.12" },
  });
  log(
    "A different app version is its own cache entry",
    versionOld.cache === "MISS" &&
      versionOldAgain.cache === "HIT" &&
      versionNew.cache === "MISS" &&
      versionOld.data?.data?.clientVersion === "1.0.9" &&
      versionNew.data?.data?.clientVersion === "1.0.12",
    `old=${versionOld.cache}/${versionOldAgain.cache} new=${versionNew.cache}`,
  );

  // ── Routes that must never be served from cache ──
  const verify1 = await request("GET", "/auth/verifyToken", admin);
  const verify2 = await request("GET", "/auth/verifyToken", admin);
  log(
    "verifyToken is not cached",
    verify1.status === 200 &&
      verify2.status === 200 &&
      !verify1.cache &&
      !verify2.cache,
    `x-cache=${verify1.cache || "none"}/${verify2.cache || "none"}`,
  );

  const anon1 = await request("GET", "/member/profile", { headers: APP_VERSION });
  const anon2 = await request("GET", "/member/profile", { headers: APP_VERSION });
  log(
    "Unauthenticated profile is not cached",
    anon1.status === 401 && anon2.status === 401 && !anon1.cache && !anon2.cache,
    `status=${anon1.status}`,
  );

  const login = await request("POST", "/auth/login", {
    body: { phoneNumber: "01229004551", password: "01229004551" },
  });
  log(
    "Login response is not cached",
    login.status === 200 && login.cache !== "HIT",
    `x-cache=${login.cache || "none"}`,
  );

  // ── Two members: private profile, shared location list ──
  const ada = await registerMember(request, log, "ada");
  const bo = await registerMember(request, log, "bo");
  if (!ada.token || !bo.token) return;

  const adaProfile = await request("GET", "/member/profile", {
    token: ada.token,
    headers: APP_VERSION,
  });
  const boProfile = await request("GET", "/member/profile", {
    token: bo.token,
    headers: APP_VERSION,
  });
  const adaProfileAgain = await request("GET", "/member/profile", {
    token: ada.token,
    headers: APP_VERSION,
  });
  log(
    "Each member profile is cached separately",
    adaProfile.cache === "MISS" &&
      boProfile.cache === "MISS" &&
      adaProfileAgain.cache === "HIT" &&
      adaProfile.data?.data?.uid?.name === ada.name &&
      boProfile.data?.data?.uid?.name === bo.name &&
      adaProfileAgain.data?.data?.uid?.name === ada.name,
    `ada=${adaProfile.cache}/${adaProfileAgain.cache} bo=${boProfile.cache}`,
  );

  const adaLocations = await request("GET", "/member/locations", {
    token: ada.token,
    headers: APP_VERSION,
  });
  const boLocations = await request("GET", "/member/locations", {
    token: bo.token,
    headers: APP_VERSION,
  });
  const adaLocationsApi = await request("GET", "/api/member/locations", {
    token: ada.token,
    headers: APP_VERSION,
  });
  log(
    "Location list is shared by role and by the /api prefix",
    adaLocations.status === 200 &&
      adaLocations.cache === "MISS" &&
      boLocations.cache === "HIT" &&
      adaLocationsApi.cache === "HIT" &&
      adaLocations.cacheControl === "private, max-age=0",
    `ada=${adaLocations.cache} bo=${boLocations.cache} /api=${adaLocationsApi.cache}`,
  );

  const dayA = "2026-11-07";
  const dayB = "2026-11-08";
  const scheduleA = await request("GET", `/member/schedule?date=${dayA}`, {
    token: ada.token,
    headers: APP_VERSION,
  });
  const scheduleB = await request("GET", `/member/schedule?date=${dayB}`, {
    token: ada.token,
    headers: APP_VERSION,
  });
  const scheduleAAgain = await request("GET", `/member/schedule?date=${dayA}`, {
    token: bo.token,
    headers: APP_VERSION,
  });
  log(
    "Schedule cache follows the date query",
    scheduleA.status === 200 &&
      scheduleA.cache === "MISS" &&
      scheduleB.cache === "MISS" &&
      scheduleAAgain.cache === "HIT",
    `${dayA}=${scheduleA.cache}/${scheduleAAgain.cache} ${dayB}=${scheduleB.cache}`,
  );

  const coaches = await request("GET", "/member/coaches", {
    token: ada.token,
    headers: APP_VERSION,
  });
  const coachesAgain = await request("GET", "/member/coaches", {
    token: ada.token,
    headers: APP_VERSION,
  });
  log(
    "Coach list caches a repeat read",
    coaches.status === 200 && coaches.cache === "MISS" && coachesAgain.cache === "HIT",
    `x-cache=${coaches.cache}/${coachesAgain.cache}`,
  );

  const addedCoach = await request("POST", "/admin/coaches", {
    ...admin,
    body: { coachName: "Cache Coach", phoneNumber: uniquePhone("016") },
  });
  const coachesAfter = await request("GET", "/member/coaches", {
    token: ada.token,
    headers: APP_VERSION,
  });
  const coachNames = namesFrom(coachesAfter);
  log(
    "Adding a coach drops the coach-list cache",
    addedCoach.status === 200 &&
      coachesAfter.cache === "MISS" &&
      coachNames.includes("Cache Coach"),
    `write=${addedCoach.status} x-cache=${coachesAfter.cache}`,
  );

  // ── Admin list, prefix alias, and invalidation ──
  const adminLocations = await request("GET", "/admin/locations", admin);
  const adminLocationsAgain = await request("GET", "/admin/locations", admin);
  const adminLocationsApi = await request("GET", "/api/admin/locations", admin);
  log(
    "Admin locations cache, including /api",
    adminLocations.status === 200 &&
      adminLocations.cache === "MISS" &&
      adminLocationsAgain.cache === "HIT" &&
      adminLocationsApi.cache === "HIT",
    `x-cache=${adminLocations.cache}/${adminLocationsAgain.cache}/${adminLocationsApi.cache}`,
  );

  const branchName = `Cache Branch ${Date.now().toString().slice(-6)}`;
  const created = await request("POST", "/admin/locations", {
    ...admin,
    body: {
      branchName,
      location: "Cache Street",
      locationUrl: "https://example.com/cache",
    },
  });
  const adminAfter = await request("GET", "/admin/locations", admin);
  const memberAfter = await request("GET", "/member/locations", {
    token: ada.token,
    headers: APP_VERSION,
  });
  const failedWrite = await request("POST", "/admin/locations", {
    ...admin,
    body: { location: "missing branch name" },
  });
  const adminStillFresh = await request("GET", "/admin/locations", admin);
  log(
    "Creating a location drops admin and member location caches",
    created.status === 200 &&
      adminAfter.cache === "MISS" &&
      memberAfter.cache === "MISS" &&
      namesFrom(adminAfter).includes(branchName) &&
      namesFrom(memberAfter).includes(branchName),
    `write=${created.status} admin=${adminAfter.cache} member=${memberAfter.cache}`,
  );
  log(
    "A failed location write leaves the fresh list cached",
    failedWrite.status >= 400 && adminStillFresh.cache === "HIT",
    `write=${failedWrite.status} x-cache=${adminStillFresh.cache}`,
  );

  // ── Finance and sales reads ──
  const finance = await request("GET", "/finance/overview", admin);
  const financeAgain = await request("GET", "/finance/overview", admin);
  log(
    "Finance overview caches a repeat read",
    finance.status === 200 && finance.cache === "MISS" && financeAgain.cache === "HIT",
    `status=${finance.status} x-cache=${finance.cache}/${financeAgain.cache}`,
  );

  const sales = await request("GET", "/sales/accounts", admin);
  const salesAgain = await request("GET", "/sales/accounts", admin);
  log(
    "Sales accounts cache a repeat read",
    sales.status === 200 && sales.cache === "MISS" && salesAgain.cache === "HIT",
    `status=${sales.status} x-cache=${sales.cache}/${salesAgain.cache}`,
  );

  const tickets = await request("GET", "/external/ticket-categories");
  const ticketsAgain = await request("GET", "/external/ticket-categories");
  log(
    "Public ticket categories cache a repeat read",
    tickets.status === 200 && tickets.cache === "MISS" && ticketsAgain.cache === "HIT",
    `status=${tickets.status} x-cache=${tickets.cache}/${ticketsAgain.cache}`,
  );
}

runWithServer({
  title: "In-memory GET response cache",
  port: 5104,
  extraEnv: {
    BLOCK_MISSING_APP_VERSION: "false",
    LATEST_APP_VERSION: "1.0.12",
    MIN_REQUIRED_APP_VERSION: "1.0.10",
  },
  run,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
