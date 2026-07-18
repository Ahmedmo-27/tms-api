#!/usr/bin/env node
/**
 * E2E: branch / location rules for packages.
 * - OPEN_GYM requires locationId on create
 * - Front-desk OPEN_GYM PACKAGE_BRANCH_MISMATCH
 * - Pending members restricted to Matcha packages
 * - Admin package list scoped by location
 *
 * Usage: node scripts/test-package-branch-flows.js
 */

const {
  runWithServer,
  loginAdmin,
  uniquePhone,
  todayDateOnly,
} = require("./lib/e2e-harness");

async function run({ seeded, request, log, queryDb }) {
  const adminToken = await loginAdmin(request, log);
  if (!adminToken) return;
  const auth = { token: adminToken };
  const startDate = todayDateOnly();

  // ── 1. Create OPEN_GYM without locationId → LOCATION_REQUIRED ──
  const noLoc = await request("POST", "/admin/packages", {
    ...auth,
    body: {
      name: "Bad Open Gym",
      category: "OPEN_GYM",
      price: 1000,
      expiryPeriod: 14,
      numberOfSessions: 10000,
    },
  });
  log(
    "OPEN_GYM create without locationId rejected",
    noLoc.status === 400 && noLoc.data?.code === "LOCATION_REQUIRED",
    `status=${noLoc.status} code=${noLoc.data?.code}`,
  );

  // ── 2. Create OPEN_GYM with Matcha location → OK ──
  const createOk = await request("POST", "/admin/packages", {
    ...auth,
    body: {
      name: "Open Gym Matcha 14d",
      category: "OPEN_GYM",
      price: 900,
      expiryPeriod: 14,
      numberOfSessions: 10000,
      locationId: seeded.matchaLocationId,
    },
  });
  const createdOpenGymId = createOk.data?.data?._id;
  log(
    "OPEN_GYM create with Matcha locationId succeeds",
    createOk.status === 200 && !!createdOpenGymId,
    `id=${createdOpenGymId}`,
  );

  // ── 3. Front-desk member OPEN_GYM wrong branch → PACKAGE_BRANCH_MISMATCH ──
  const memberPhone = uniquePhone("010");
  const memberReg = await request("POST", "/auth/register", {
    body: {
      name: "Branch Member",
      email: `branch.${memberPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: memberPhone,
      role: "user",
    },
  });
  const memberUid = memberReg.data?.data?.user?._id;
  await request("POST", `/admin/member/${memberUid}`, auth);

  const mismatch = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: memberUid,
      pkgId: seeded.packagesByCategory.OPEN_GYM, // Matcha-bound
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      locationId: seeded.otherLocationId, // wrong branch
    },
  });
  log(
    "OPEN_GYM front-desk wrong location → PACKAGE_BRANCH_MISMATCH",
    mismatch.status === 400 &&
      mismatch.data?.code === "PACKAGE_BRANCH_MISMATCH",
    `status=${mismatch.status} code=${mismatch.data?.code}`,
  );

  const matchOk = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: memberUid,
      pkgId: seeded.packagesByCategory.OPEN_GYM,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      locationId: seeded.matchaLocationId,
    },
  });
  log(
    "OPEN_GYM front-desk matching Matcha location succeeds",
    matchOk.status === 200,
    matchOk.data?.message || matchOk.data?.code || `status=${matchOk.status}`,
  );

  // Other-branch OPEN_GYM with its own location
  const otherOk = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: memberUid,
      pkgId: seeded.packagesByCategory.OPEN_GYM_OTHER,
      pkgStartDate: "2026-08-15",
      paymentMethod: "CASH",
      locationId: seeded.otherLocationId,
    },
  });
  log(
    "OPEN_GYM other-branch package with matching location succeeds",
    otherOk.status === 200,
    otherOk.data?.message || otherOk.data?.code || `status=${otherOk.status}`,
  );

  // ── 4. Admin package list filtered by location includes null + that location ──
  const listMatcha = await request(
    "GET",
    `/admin/packages?locationId=${seeded.matchaLocationId}`,
    auth,
  );
  const matchaPkgs = listMatcha.data?.data || [];
  const onlyMatchaOrGlobal = matchaPkgs.every((p) => {
    if (!p.locationId) return true;
    const id = (p.locationId._id || p.locationId).toString();
    return id === seeded.matchaLocationId;
  });
  const hasOpenGymMatcha = matchaPkgs.some(
    (p) =>
      p.category === "OPEN_GYM" &&
      (p.locationId?._id || p.locationId)?.toString() ===
        seeded.matchaLocationId,
  );
  log(
    "Admin packages?locationId=Matcha returns only Matcha or global",
    listMatcha.status === 200 && onlyMatchaOrGlobal && hasOpenGymMatcha,
    `count=${matchaPkgs.length}`,
  );

  // ── 5. Pending member Matcha package restriction ──
  const pendingPhone = uniquePhone("019");
  const pendingReg = await request("POST", "/auth/register", {
    body: {
      name: "Pending Matcha",
      email: `pending.${pendingPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: pendingPhone,
      role: "user",
    },
  });
  const pendingToken = pendingReg.data?.data?.token;
  const pendingAuth = { token: pendingToken };

  const listPending = await request("GET", "/member/packages", pendingAuth);
  const catalog = Array.isArray(listPending.data?.data)
    ? listPending.data.data
    : [];

  const allMatcha = catalog.every((p) => {
    if (!p.locationId) return false;
    return (
      (p.locationId._id || p.locationId).toString() === seeded.matchaLocationId
    );
  });
  const hasNoOtherBranch = !catalog.some(
    (p) =>
      (p.locationId?._id || p.locationId)?.toString() ===
      seeded.otherLocationId,
  );
  log(
    "Pending member package catalog is Matcha-scoped",
    listPending.status === 200 &&
      catalog.length > 0 &&
      allMatcha &&
      hasNoOtherBranch,
    `status=${listPending.status} count=${catalog.length}`,
  );

  // ── 6. Non-user OPEN_GYM can stage per branch catalog package ──
  const guestPhone = uniquePhone("018");
  const stageMatcha = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Guest Matcha OG",
      phoneNumber: guestPhone,
      pkgId: seeded.packagesByCategory.OPEN_GYM,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      locationId: seeded.matchaLocationId,
    },
  });
  log(
    "Non-member: stage Matcha OPEN_GYM",
    stageMatcha.status === 200,
    `status=${stageMatcha.status}`,
  );

  const guestPhone2 = uniquePhone("017");
  const stageOther = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Guest Other OG",
      phoneNumber: guestPhone2,
      pkgId: seeded.packagesByCategory.OPEN_GYM_OTHER,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      locationId: seeded.otherLocationId,
    },
  });
  log(
    "Non-member: stage other-branch OPEN_GYM",
    stageOther.status === 200,
    `status=${stageOther.status}`,
  );

  // Duplicate same branch/day still blocked
  const stageDup = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Guest Matcha OG",
      phoneNumber: guestPhone,
      pkgId: seeded.packagesByCategory.OPEN_GYM,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      locationId: seeded.matchaLocationId,
    },
  });
  log(
    "Non-member: duplicate Matcha OPEN_GYM same day rejected",
    stageDup.status === 409 && stageDup.data?.code === "PACKAGE_ALREADY_ADDED",
    `status=${stageDup.status} code=${stageDup.data?.code}`,
  );

  // ── 7. Accept transfers branch OPEN_GYM onto member ──
  const regGuest = await request("POST", "/auth/register", {
    body: {
      name: "Guest Matcha OG",
      email: `og.${guestPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: guestPhone,
      role: "user",
    },
  });
  const guestUid = regGuest.data?.data?.user?._id;
  const accept = await request("POST", `/admin/member/${guestUid}`, auth);
  const pkgs = accept.data?.data?.packages || [];
  log(
    "Accept transfers staged Matcha OPEN_GYM to member",
    accept.status === 200 && pkgs.length === 1,
    `packages=${pkgs.length}`,
  );

  const paymentLoc = await queryDb(async (db) => {
    const staged = await db
      .collection("nonuserpackages")
      .findOne({ phoneNumber: guestPhone });
    if (!staged?.paymentId) return null;
    return db.collection("payments").findOne({ _id: staged.paymentId });
  });
  log(
    "Non-member OPEN_GYM payment stores locationId",
    !!paymentLoc &&
      paymentLoc.locationId?.toString() === seeded.matchaLocationId,
    `locationId=${paymentLoc?.locationId}`,
  );
}

runWithServer({
  title: "Package branch / location rules E2E",
  port: 5103,
  run,
}).catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
