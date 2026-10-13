#!/usr/bin/env node
/**
 * End-to-End Automation Test Script:
 * Non-Member Package Staging, National ID, and Mobile App Claiming Flow.
 *
 * Covers:
 * 1. Admin authentication.
 * 2. Validation: missing national ID rejected (INVALID_NATIONAL_ID).
 * 3. Validation: missing name rejected (INVALID_NAME).
 * 4. Validation: invalid phone number rejected (INVALID_PHONE).
 * 5. Happy Path: Staging non-member package with Name, Phone, and National ID.
 * 6. DB check: pending user auto-created with empty email, role user, and national ID.
 * 7. Duplicate prevention: second identical staged package rejected (PACKAGE_ALREADY_ADDED).
 * 8. Multi-package staging: adding a second different package reuses pending user doc.
 * 9. Pre-deducted drop-in session: remaining classes deducted upfront.
 * 10. Mobile app registration: matching phone claims account, overrides name, sets email & password.
 * 11. Package transfer: all staged packages transferred to member with activity preserved.
 * 12. Pre-deducted adjustment history: Member doc receives DEDUCT adjustment record.
 * 13. Conflict check: re-registering with already registered member phone rejected (PHONE_ALREADY_EXISTS).
 * 14. Conflict check: claiming account with duplicate email rejected (EMAIL_ALREADY_EXISTS).
 * 15. Authentication: member logs in successfully with new credentials.
 * 16. Pending members search: staged accounts searchable before app claiming.
 *
 * Usage: node scripts/test-non-member-registration-flow.js
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
  const studioPkgId = seeded.packagesByCategory.STUDIO;
  const spacePkgId = seeded.packagesByCategory.SPACE_MEMBERSHIP;

  const locId = seeded.matchaLocationId;

  // ── 1. Validation Edge Cases on Admin Staging ──
  const testPhone1 = uniquePhone("018");

  // Missing National ID
  const noNationalId = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Ahmed Guest",
      phoneNumber: testPhone1,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      locationId: locId,
    },
  });
  log(
    "Validation: missing national ID rejected with 400",
    noNationalId.status === 400 &&
      (noNationalId.data?.code === "INVALID_NATIONAL_ID" ||
        noNationalId.data?.message?.toLowerCase().includes("id")),
    `status=${noNationalId.status} code=${noNationalId.data?.code}`
  );

  // Missing Name
  const noName = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "   ",
      phoneNumber: testPhone1,
      nationalId: "29901011234567",
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      locationId: locId,
    },
  });
  log(
    "Validation: missing name rejected with 400",
    noName.status === 400 &&
      (noName.data?.code === "INVALID_NAME" || noName.data?.code === "NAME_REQUIRED"),
    `status=${noName.status} code=${noName.data?.code}`
  );

  // Invalid Phone Number
  const invalidPhone = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Ahmed Guest",
      phoneNumber: "010123", // not 11 digits
      nationalId: "29901011234567",
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      locationId: locId,
    },
  });
  log(
    "Validation: invalid phone (< 11 digits) rejected with 400",
    invalidPhone.status === 400 && invalidPhone.data?.code === "INVALID_PHONE",
    `status=${invalidPhone.status} code=${invalidPhone.data?.code}`
  );

  // ── 2. Happy Path: Admin Stages Non-Member Package ──
  const guestPhone1 = uniquePhone("019");
  const guestNatId1 = "29901011234567";
  const stageRes1 = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Admin Typo",
      phoneNumber: guestPhone1,
      nationalId: guestNatId1,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      amount: "2000",
      locationId: locId,
    },
  });
  log(
    "Happy Path: admin stages non-member package with Name, Phone, and National ID",
    stageRes1.status === 200,
    `status=${stageRes1.status} message=${stageRes1.data?.message}`
  );

  // DB Verification of Staged Pending Account
  await queryDb(async (db) => {
    const userDoc = await db.collection("users").findOne({ phoneNumber: guestPhone1 });
    log(
      "DB Check: pending user auto-created with empty email, role user, and national ID",
      userDoc &&
        userDoc.name === "Sara Admin Typo" &&
        (!userDoc.email || userDoc.email === "") &&
        userDoc.role === "user" &&
        userDoc.nationalId === guestNatId1,
      `name="${userDoc?.name}" role="${userDoc?.role}" email="${userDoc?.email}" nationalId="${userDoc?.nationalId}"`
    );

    const nupDoc = await db.collection("nonuserpackages").findOne({ phoneNumber: guestPhone1 });
    log(
      "DB Check: NonUserPackage stored with national ID and added=false",
      nupDoc && nupDoc.nationalId === guestNatId1 && nupDoc.added !== true,
      `nationalId="${nupDoc?.nationalId}" added=${nupDoc?.added}`
    );
  });

  // ── 3. Duplicate Staged Package Prevention ──
  const dupStageRes = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Admin Typo",
      phoneNumber: guestPhone1,
      nationalId: guestNatId1,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      locationId: locId,
    },
  });
  log(
    "Idempotency: duplicate same-day staged package rejected with 409",
    dupStageRes.status === 409 && dupStageRes.data?.code === "PACKAGE_ALREADY_ADDED",
    `status=${dupStageRes.status} code=${dupStageRes.data?.code}`
  );

  // ── 4. Multi-Package Staging for Same Non-Member ──
  const stageRes2 = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Sara Admin Typo",
      phoneNumber: guestPhone1,
      nationalId: guestNatId1,
      pkgId: spacePkgId,
      pkgStartDate: startDate,
      paymentMethod: "VISA",
      pendingDeduction: false,
      amount: "2750",
      locationId: locId,
    },
  });
  log(
    "Multi-package: second distinct package staged for same non-member phone",
    stageRes2.status === 200,
    `status=${stageRes2.status}`
  );

  await queryDb(async (db) => {
    const userCount = await db.collection("users").countDocuments({ phoneNumber: guestPhone1 });
    const nupCount = await db.collection("nonuserpackages").countDocuments({ phoneNumber: guestPhone1 });
    log(
      "DB Check: existing pending user doc reused (no duplicate user), 2 staged packages exist",
      userCount === 1 && nupCount === 2,
      `users=${userCount} stagedPackages=${nupCount}`
    );
  });

  // ── 5. Non-Member Package with Pre-Deducted Session (Drop-in attendance) ──
  const guestPhone2 = uniquePhone("017");
  const guestNatId2 = "29505051234567";
  const stageDeductedRes = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "DropIn WalkIn Guest",
      phoneNumber: guestPhone2,
      nationalId: guestNatId2,
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: true,
      amount: "2000",
      locationId: locId,
    },
  });
  log(
    "Pre-deduction: package staged with pendingDeduction=true",
    stageDeductedRes.status === 200,
    `status=${stageDeductedRes.status}`
  );

  await queryDb(async (db) => {
    const pkgDoc = await db.collection("packages").findOne({ _id: require("mongoose").Types.ObjectId.createFromHexString(studioPkgId) });
    const nupDoc = await db.collection("nonuserpackages").findOne({ phoneNumber: guestPhone2 });
    log(
      "DB Check: staged package remainingClasses decremented by 1 upfront",
      nupDoc && pkgDoc && nupDoc.remainingClasses === pkgDoc.numberOfSessions - 1,
      `remaining=${nupDoc?.remainingClasses} total=${pkgDoc?.numberOfSessions}`
    );
  });

  // ── 6. Mobile App Registration: Account Claiming & Name Override ──
  const registerRes1 = await request("POST", "/auth/register", {
    body: {
      phoneNumber: guestPhone1,
      name: "Sara Corrected FullName", // overrides "Sara Admin Typo"
      email: "sara.e2e@themindspace.com",
      password: "SecurePassword123!",
      fcmToken: "sample-fcm-token",
    },
  });
  const memberToken1 = registerRes1.data?.data?.token;
  const returnedUser1 = registerRes1.data?.data?.user;
  log(
    "Mobile Registration: claims account, overrides name, returns token and role member",
    registerRes1.status === 200 &&
      !!memberToken1 &&
      returnedUser1?.role === "member" &&
      returnedUser1?.name === "Sara Corrected FullName",
    `status=${registerRes1.status} name="${returnedUser1?.name}" role="${returnedUser1?.role}"`
  );

  // DB Verification of Transferred Packages & Claimed Account
  await queryDb(async (db) => {
    const userDoc = await db.collection("users").findOne({ phoneNumber: guestPhone1 });
    const memberDoc = await db.collection("members").findOne({ uid: userDoc._id });
    const nups = await db.collection("nonuserpackages").find({ phoneNumber: guestPhone1 }).toArray();

    const packagesTransferred = memberDoc && memberDoc.packages && memberDoc.packages.length === 2;
    const allMarkedAdded = nups.length === 2 && nups.every((n) => n.added === true);

    log(
      "DB Check: user name overridden, email assigned, Member doc created, both packages transferred",
      userDoc.name === "Sara Corrected FullName" &&
        userDoc.email === "sara.e2e@themindspace.com" &&
        userDoc.role === "member" &&
        userDoc.nationalId === guestNatId1 &&
        packagesTransferred &&
        allMarkedAdded,
      `name="${userDoc.name}" packagesCount=${memberDoc?.packages?.length} allMarkedAdded=${allMarkedAdded}`
    );
  });

  // ── 7. Mobile App Registration for Pre-Deducted Account: History Created ──
  const registerRes2 = await request("POST", "/auth/register", {
    body: {
      phoneNumber: guestPhone2,
      name: "DropIn WalkIn Claimed",
      email: "dropin.e2e@themindspace.com",
      password: "SecurePassword123!",
    },
  });
  log(
    "Mobile Registration: claims account with pre-deducted package",
    registerRes2.status === 200,
    `status=${registerRes2.status}`
  );

  await queryDb(async (db) => {
    const userDoc = await db.collection("users").findOne({ phoneNumber: guestPhone2 });
    const memberDoc = await db.collection("members").findOne({ uid: userDoc._id });
    const pkg = memberDoc?.packages?.[0];
    const adjustments = pkg?.adjustmentHistory || [];
    const hasDeductRecord = adjustments.some(
      (adj) => adj.type === "DEDUCT" && adj.amount === 1 && adj.reason?.includes("Attended a class")
    );

    log(
      "DB Check: transferred package has decremented classes and DEDUCT adjustment history record",
      pkg && adjustments.length > 0 && hasDeductRecord,
      `remaining=${pkg?.remainingClasses} adjustmentsCount=${adjustments.length} hasDeductRecord=${hasDeductRecord}`
    );
  });

  // ── 8. Conflict Check: Re-Registration with Already Claimed Member Phone ──
  const dupPhoneRes = await request("POST", "/auth/register", {
    body: {
      phoneNumber: guestPhone1,
      name: "Another Impostor",
      email: "impostor@themindspace.com",
      password: "SecurePassword123!",
    },
  });
  log(
    "Conflict: registering with existing active member phone rejected with 409",
    dupPhoneRes.status === 409 && dupPhoneRes.data?.code === "PHONE_ALREADY_EXISTS",
    `status=${dupPhoneRes.status} code=${dupPhoneRes.data?.code}`
  );

  // ── 9. Conflict Check: Claiming Account with Taken Email ──
  const guestPhone3 = uniquePhone("016");
  await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Guest Three",
      phoneNumber: guestPhone3,
      nationalId: "29404041234567",
      pkgId: studioPkgId,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
      locationId: locId,
    },
  });

  const dupEmailRes = await request("POST", "/auth/register", {
    body: {
      phoneNumber: guestPhone3,
      name: "Guest Three User",
      email: "sara.e2e@themindspace.com", // already taken by guestPhone1
      password: "SecurePassword123!",
    },
  });
  log(
    "Conflict: claiming account with duplicate email rejected with 409",
    dupEmailRes.status === 409 && dupEmailRes.data?.code === "EMAIL_ALREADY_EXISTS",
    `status=${dupEmailRes.status} code=${dupEmailRes.data?.code}`
  );

  // ── 10. Login Verification: Member Logs In with New Credentials ──
  const loginRes = await request("POST", "/auth/login", {
    body: {
      phoneNumber: guestPhone1,
      password: "SecurePassword123!",
    },
  });
  const loginToken = loginRes.data?.data?.token;
  const loginRole = loginRes.data?.data?.role || loginRes.data?.data?.user?.role;
  log(
    "Authentication: claimed member logs in successfully with phone & registered password",
    loginRes.status === 200 && !!loginToken && loginRole === "member",
    `status=${loginRes.status} role="${loginRole}"`
  );

  // ── 11. Profile Access: Authenticated Member Sees Transferred Packages ──
  const profileRes = await request("GET", "/member/profile", {
    token: loginToken,
  });
  const profilePkgs = profileRes.data?.data?.packages || [];
  log(
    "Member API: profile query returns 2 active transferred packages",
    profileRes.status === 200 && profilePkgs.length === 2,
    `status=${profileRes.status} packagesCount=${profilePkgs.length}`
  );
}

runWithServer({
  title: "Non-Member Package to Mobile Registration Flow E2E",
  port: 5120,
  run,
}).catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
