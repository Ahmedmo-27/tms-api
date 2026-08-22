#!/usr/bin/env node
/**
 * E2E: duplicate package prevention for members + non-members,
 * including Sarah-style staged duplicates on accept.
 *
 * Usage: node scripts/test-package-duplicate-flows.js
 */

const {
  runWithServer,
  loginAdmin,
  uniquePhone,
  todayDateOnly,
  PACKAGE_CATEGORIES,
} = require("./lib/e2e-harness");

async function run({ seeded, request, log, queryDb }) {
  const adminToken = await loginAdmin(request, log);
  if (!adminToken) return;
  const auth = { token: adminToken };
  const startDate = todayDateOnly();
  const spacePkgId = seeded.packagesByCategory.SPACE_MEMBERSHIP;
  const studioPkgId = seeded.packagesByCategory.STUDIO;

  // ── 1. Non-member: second same-day staged package is rejected ──
  const guestPhone = uniquePhone("018");
  const firstStage = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Elaraby",
      phoneNumber: guestPhone,
      pkgId: spacePkgId,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      amount: "2750",
    },
  });
  log(
    "Non-member: first Space membership stages",
    firstStage.status === 200,
    firstStage.data?.message || firstStage.data?.code || `status=${firstStage.status}`,
  );

  const dupStage = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Elaraby",
      phoneNumber: guestPhone,
      pkgId: spacePkgId,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      amount: "2750",
    },
  });
  log(
    "Non-member: duplicate same-day Space membership rejected",
    dupStage.status === 409 && dupStage.data?.code === "PACKAGE_ALREADY_ADDED",
    `status=${dupStage.status} code=${dupStage.data?.code}`,
  );

  const paymentCount = await queryDb(async (db) =>
    db.collection("payments").countDocuments({
      nonMemberPhone: guestPhone,
      purpose: "NON_USER_PACKAGE",
    }),
  );
  log(
    "Non-member: duplicate did not create a second payment",
    paymentCount === 1,
    `payments=${paymentCount}`,
  );

  // ── 2. Sarah-style: two distinct start days + one same-day duplicate via DB ──
  // Seed a second start-day package + an injected same-day duplicate (pre-fix state).
  const sarahPhone = uniquePhone("017");
  const dayA = "2026-07-03";
  const dayB = "2026-07-04";

  const stageDayA = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Yasmine Hassan",
      phoneNumber: sarahPhone,
      pkgId: spacePkgId,
      pkgStartDate: dayA,
      paymentMethod: "VISA",
      pendingDeduction: false,
      amount: "2750",
    },
  });
  const stageDayB = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Elaraby",
      phoneNumber: sarahPhone,
      pkgId: spacePkgId,
      pkgStartDate: dayB,
      paymentMethod: "VISA",
      pendingDeduction: false,
      amount: "2750",
    },
  });
  log(
    "Sarah setup: two distinct start-day packages staged",
    stageDayA.status === 200 && stageDayB.status === 200,
    `dayA=${stageDayA.status} dayB=${stageDayB.status}`,
  );

  // Inject a same-day duplicate that the old front-desk path used to allow
  await queryDb(async (db) => {
    const { Types } = require("mongoose");
    const existing = await db.collection("nonuserpackages").findOne({
      phoneNumber: sarahPhone,
      pkgStartDate: {
        $gte: new Date("2026-07-03T00:00:00.000Z"),
        $lt: new Date("2026-07-04T00:00:00.000Z"),
      },
    });
    if (!existing) return;
    await db.collection("nonuserpackages").insertOne({
      name: "Sara Elaraby",
      phoneNumber: sarahPhone,
      pkgId: new Types.ObjectId(spacePkgId),
      pkgStartDate: existing.pkgStartDate,
      pkgEndDate: existing.pkgEndDate,
      remainingClasses: 10000,
      paymentId: existing.paymentId,
      added: false,
      createdAt: new Date("2026-07-10T13:34:51.000Z"),
    });
  });

  const stagedCount = await queryDb(async (db) =>
    db.collection("nonuserpackages").countDocuments({
      phoneNumber: sarahPhone,
      added: false,
    }),
  );
  log(
    "Sarah setup: three unused staged rows (incl. same-day duplicate)",
    stagedCount === 3,
    `staged=${stagedCount}`,
  );

  const regRes = await request("POST", "/auth/register", {
    body: {
      name: "Sara Elaraby",
      email: `sara.${sarahPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: sarahPhone,
      role: "user",
    },
  });
  const sarahUserId = regRes.data?.data?.user?._id;
  log("Sarah: registers as pending user", !!sarahUserId, `uid=${sarahUserId}`);

  const acceptRes = await request("POST", `/admin/member/${sarahUserId}`, auth);
  log(
    "Sarah: accept succeeds despite staged duplicates",
    acceptRes.status === 200,
    acceptRes.data?.message || acceptRes.data?.code || `status=${acceptRes.status}`,
  );

  const memberPkgs = acceptRes.data?.data?.packages || [];
  const startDays = new Set(
    memberPkgs.map((p) => new Date(p.pkgStartDate).toISOString().slice(0, 10)),
  );
  log(
    "Sarah: exactly two packages transferred (Jul 3 + Jul 4)",
    memberPkgs.length === 2 && startDays.size === 2,
    `count=${memberPkgs.length} days=${[...startDays].join(",")}`,
  );

  const allMarked = await queryDb(async (db) => {
    const rows = await db
      .collection("nonuserpackages")
      .find({ phoneNumber: sarahPhone })
      .toArray();
    return rows.length === 3 && rows.every((r) => r.added === true);
  });
  log(
    "Sarah: all three staged rows marked added=true",
    allMarked,
    "",
  );

  // ── 3. Member: duplicate same-day front-desk add rejected ──
  const memberPhone = uniquePhone("016");
  const memberReg = await request("POST", "/auth/register", {
    body: {
      name: "Member Dupe",
      email: `member.${memberPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: memberPhone,
      role: "user",
    },
  });
  const memberUid = memberReg.data?.data?.user?._id;
  await request("POST", `/admin/member/${memberUid}`, auth);

  const add1 = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: memberUid,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      amount: 2250,
    },
  });
  log(
    "Member: first Studio package added",
    add1.status === 200,
    add1.data?.message || add1.data?.code || `status=${add1.status}`,
  );

  const add2 = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: memberUid,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      amount: 2250,
    },
  });
  log(
    "Member: duplicate same-day Studio rejected",
    add2.status === 409 && add2.data?.code === "PACKAGE_ALREADY_ADDED",
    `status=${add2.status} code=${add2.data?.code}`,
  );

  // ── 4. Cross-path: staged unused blocks member add for same phone/pkg/day ──
  const crossPhone = uniquePhone("015");
  const crossReg = await request("POST", "/auth/register", {
    body: {
      name: "Cross Path",
      email: `cross.${crossPhone}@test.com`,
      password: "TestPass1!",
      phoneNumber: crossPhone,
      role: "user",
    },
  });
  const crossUid = crossReg.data?.data?.user?._id;
  await request("POST", `/admin/member/${crossUid}`, auth);

  const stageCross = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Cross Path",
      phoneNumber: crossPhone,
      pkgId: seeded.packagesByCategory.MIXED,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    },
  });
  log(
    "Cross-path: stage unused MIXED for member phone",
    stageCross.status === 200,
    `status=${stageCross.status}`,
  );

  const memberBlocked = await request("POST", "/admin/member-packages", {
    ...auth,
    body: {
      uid: crossUid,
      pkgId: seeded.packagesByCategory.MIXED,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
    },
  });
  log(
    "Cross-path: member add blocked by unused staged package",
    memberBlocked.status === 409 &&
      memberBlocked.data?.code === "PACKAGE_ALREADY_ADDED",
    `status=${memberBlocked.status} code=${memberBlocked.data?.code}`,
  );

  // ── 5. Smoke: each category can stage once without duplicate error ──
  for (const category of PACKAGE_CATEGORIES) {
    const pkgId = seeded.packagesByCategory[category];
    const phone = uniquePhone("014");
    const body = {
      name: `${category} Guest`,
      phoneNumber: phone,
      pkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    };
    if (category === "OPEN_GYM") {
      body.locationId = seeded.matchaLocationId;
    }
    const res = await request("POST", "/admin/nonUserPackage", {
      ...auth,
      body,
    });
    log(
      `Category smoke: ${category} stages once`,
      res.status === 200,
      res.data?.message || res.data?.code || `status=${res.status}`,
    );
  }
}

runWithServer({
  title: "Package duplicate prevention E2E",
  port: 5101,
  run,
}).catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
