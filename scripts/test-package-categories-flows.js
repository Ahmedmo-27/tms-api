#!/usr/bin/env node
/**
 * E2E: package add + transfer for every package category
 * (FUNCTIONAL_TRAINING, STUDIO, PERSONAL_TRAINING, PRE_POST_NATAL,
 *  MIXED, SPACE_MEMBERSHIP, ULTIMATE_MINDSPACER, OPEN_GYM).
 *
 * Usage: node scripts/test-package-categories-flows.js
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

  for (const category of PACKAGE_CATEGORIES) {
    const pkgId = seeded.packagesByCategory[category];
    const phone = uniquePhone("013");
    const name = `${category} Client`;

    // Non-member stage → register → accept → package on member
    const stageBody = {
      name,
      phoneNumber: phone,
      pkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    };
    if (category === "OPEN_GYM") {
      stageBody.locationId = seeded.matchaLocationId;
    }

    const stageRes = await request("POST", "/admin/nonUserPackage", {
      ...auth,
      body: stageBody,
    });
    log(
      `${category}: non-member stage`,
      stageRes.status === 200,
      stageRes.data?.message || stageRes.data?.code || `status=${stageRes.status}`,
    );

    const staged = await queryDb(async (db) =>
      db.collection("nonuserpackages").findOne({ phoneNumber: phone }),
    );
    log(
      `${category}: staged unused with payment`,
      !!staged && staged.added !== true && !!staged.paymentId,
      `remaining=${staged?.remainingClasses}`,
    );

    const reg = await request("POST", "/auth/register", {
      body: {
        name,
        email: `${category.toLowerCase()}.${phone}@test.com`,
        password: "TestPass1!",
        phoneNumber: phone,
        role: "user",
      },
    });
    const uid = reg.data?.data?.user?._id;
    const accept = await request("POST", `/admin/member/${uid}`, auth);
    const packages = accept.data?.data?.packages || [];
    const transferred = packages.find(
      (p) => (p.pkgId?._id || p.pkgId)?.toString?.() === pkgId ||
        String(p.pkgId) === pkgId,
    );

    log(
      `${category}: transfer on accept`,
      accept.status === 200 && packages.length >= 1,
      `status=${accept.status} packages=${packages.length}`,
    );
    log(
      `${category}: transferred package has expected remaining sessions`,
      !!transferred &&
        typeof transferred.remainingClasses === "number" &&
        transferred.remainingClasses > 0,
      `remaining=${transferred?.remainingClasses}`,
    );

    // Front-desk add of a *different* category package on a fresh member
    const memberPhone = uniquePhone("012");
    const memberReg = await request("POST", "/auth/register", {
      body: {
        name: `${category} Direct`,
        email: `direct.${category.toLowerCase()}.${memberPhone}@test.com`,
        password: "TestPass1!",
        phoneNumber: memberPhone,
        role: "user",
      },
    });
    const memberUid = memberReg.data?.data?.user?._id;
    await request("POST", `/admin/member/${memberUid}`, auth);

    const otherStart = "2026-08-01";
    const addBody = {
      uid: memberUid,
      pkgId,
      pkgStartDate: otherStart,
      paymentMethod: "VISA",
    };
    if (category === "OPEN_GYM") {
      addBody.locationId = seeded.matchaLocationId;
    }

    const addRes = await request("POST", "/admin/member-packages", {
      ...auth,
      body: addBody,
    });
    log(
      `${category}: front-desk member-packages add`,
      addRes.status === 200,
      addRes.data?.message || addRes.data?.code || `status=${addRes.status}`,
    );

    const dupRes = await request("POST", "/admin/member-packages", {
      ...auth,
      body: addBody,
    });
    log(
      `${category}: front-desk duplicate same start day rejected`,
      dupRes.status === 409 && dupRes.data?.code === "PACKAGE_ALREADY_ADDED",
      `status=${dupRes.status} code=${dupRes.data?.code}`,
    );

    // Payment purpose for member add
    const payment = await queryDb(async (db) =>
      db.collection("payments").findOne({
        uid: require("mongoose").Types.ObjectId.createFromHexString(memberUid),
        pkgId: require("mongoose").Types.ObjectId.createFromHexString(pkgId),
        purpose: "PACKAGE",
      }),
    );
    log(
      `${category}: member payment purpose PACKAGE`,
      !!payment && payment.isRefunded !== true,
      `amount=${payment?.amount} method=${payment?.paymentMethod}`,
    );
  }

  // Unlimited space categories keep high remaining after transfer
  for (const category of [
    "OPEN_GYM",
    "SPACE_MEMBERSHIP",
    "ULTIMATE_MINDSPACER",
    "MIXED",
  ]) {
    const phone = uniquePhone("011");
    await request("POST", "/admin/nonUserPackage", {
      ...auth,
      body: {
        name: `${category} Unlimited`,
        phoneNumber: phone,
        pkgId: seeded.packagesByCategory[category],
        pkgStartDate: "2026-09-01",
        paymentMethod: "CASH",
        pendingDeduction: false,
        ...(category === "OPEN_GYM"
          ? { locationId: seeded.matchaLocationId }
          : {}),
      },
    });
    const reg = await request("POST", "/auth/register", {
      body: {
        name: `${category} Unlimited`,
        email: `unlim.${category.toLowerCase()}.${phone}@test.com`,
        password: "TestPass1!",
        phoneNumber: phone,
        role: "user",
      },
    });
    const uid = reg.data?.data?.user?._id;
    const accept = await request("POST", `/admin/member/${uid}`, auth);
    const pkg = (accept.data?.data?.packages || [])[0];
    const expectedMin = category === "MIXED" ? 8 : 10000;
    log(
      `${category}: unlimited/space-style remaining after transfer`,
      !!pkg && pkg.remainingClasses >= expectedMin,
      `remaining=${pkg?.remainingClasses} expected>=${expectedMin}`,
    );
  }
}

runWithServer({
  title: "Package categories matrix E2E",
  port: 5102,
  run,
}).catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
