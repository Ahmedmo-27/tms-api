#!/usr/bin/env node
/**
 * End-to-end test for pending member acceptance and non-user package flows.
 * Usage: node scripts/test-member-request-flow.js
 */

const API = process.env.API_URL || "http://localhost:5000";
const ADMIN_PHONE = process.env.ADMIN_PHONE || "01229004551";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "01229004551";

const results = [];

function log(step, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  results.push({ step, ok, detail });
}

async function request(method, path, { token, cookie, body } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${API}${path}`, {
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

  return { status: res.status, data, headers: res.headers };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return values.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  console.log(`\nTesting against ${API}\n`);

  // 1. Admin login
  const loginRes = await request("POST", "/auth/login", {
    body: { phoneNumber: ADMIN_PHONE, password: ADMIN_PASSWORD },
  });
  const loginData = loginRes.data?.data;
  const adminToken = loginData?.token;
  const adminCookie = extractCookie(loginRes.headers.getSetCookie?.() || loginRes.headers.get("set-cookie"));
  log(
    "Admin login",
    loginRes.status === 200 && ["admin", "management", "branch_admin", "fd"].includes(loginData?.role),
    `role=${loginData?.role || "n/a"} status=${loginRes.status}`
  );
  if (!adminToken) {
    console.error("\nCannot continue without admin token.");
    process.exit(1);
  }

  const auth = { token: adminToken, cookie: adminCookie };

  // 2. List pending members
  const pendingRes = await request("GET", "/admin/pending-members?page=1&limit=10", auth);
  const pendingUsers = pendingRes.data?.data?.users || [];
  log(
    "List pending members",
    pendingRes.status === 200 || pendingRes.status === 404,
    `count=${pendingUsers.length} status=${pendingRes.status}`
  );

  // 3. Create a fresh pending user for acceptance test
  const testPhone = `0199${Date.now().toString().slice(-7)}`;
  const testEmail = `pending.test.${Date.now()}@testmail.com`;
  const registerRes = await request("POST", "/auth/register", {
    body: {
      name: "Pending Test User",
      email: testEmail,
      password: "TestPass1!",
      phoneNumber: testPhone,
      role: "user",
    },
  });
  const pendingUserId = registerRes.data?.data?.user?._id;
  log(
    "Register pending user (role=user)",
    registerRes.status === 200 && !!pendingUserId,
    `id=${pendingUserId || "n/a"} status=${registerRes.status}`
  );

  // 4. Get a package for non-user assignment
  const packagesRes = await request("GET", "/admin/packages", auth);
  const packages = packagesRes.data?.data || [];
  const pkg = packages[0];
  log("List packages", packagesRes.status === 200 && packages.length > 0, `count=${packages.length}`);
  if (!pkg) {
    console.error("\nNo packages available to test non-user package flow.");
    process.exit(1);
  }

  // 5. Add non-user package linked to pending user's phone
  const startDate = new Date().toISOString().split("T")[0];
  const nonUserPkgRes = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Pending Test User",
      phoneNumber: testPhone,
      pkgId: pkg._id,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    },
  });
  log(
    "Add non-user package for pending phone",
    nonUserPkgRes.status === 200,
    `status=${nonUserPkgRes.status} message=${nonUserPkgRes.data?.message || nonUserPkgRes.data?.error || ""}`
  );

  // 6. Pending list should show package on user
  const pendingAfterPkgRes = await request(
    "GET",
    `/admin/pending-members?page=1&limit=50&phone=${testPhone}`,
    auth
  );
  const pendingAfter = (pendingAfterPkgRes.data?.data?.users || []).find(
    (u) => u.phoneNumber === testPhone
  );
  const hasPendingPkg = (pendingAfter?.pendingPackages || []).length > 0;
  log(
    "Pending member shows assigned package",
    pendingAfterPkgRes.status === 200 && hasPendingPkg,
    `packages=${pendingAfter?.pendingPackages?.length || 0}`
  );

  // 7. Accept member (core fix under test)
  const acceptRes = await request("POST", `/admin/member/${pendingUserId}`, auth);
  log(
    "Accept pending member",
    acceptRes.status === 200,
    `status=${acceptRes.status} message=${acceptRes.data?.message || acceptRes.data?.error || ""}`
  );

  // 8. User should no longer appear in pending list
  const pendingAfterAcceptRes = await request(
    "GET",
    `/admin/pending-members?page=1&limit=50&phone=${testPhone}`,
    auth
  );
  const stillPending =
    pendingAfterAcceptRes.status === 200 &&
    (pendingAfterAcceptRes.data?.data?.users || []).some((u) => u.phoneNumber === testPhone);
  log(
    "Accepted user removed from pending list",
    !stillPending,
    `stillPending=${stillPending}`
  );

  // 9. Member record should exist with package attached
  const memberRes = await request("GET", `/admin/member?uid=${pendingUserId}`, auth);
  const member = memberRes.data?.data?.members?.[0] || memberRes.data?.data?.[0];
  const memberPackages = member?.packages || [];
  log(
    "Member created with packages from non-user record",
    acceptRes.status === 200 && memberPackages.length > 0,
    `memberPackages=${memberPackages.length}`
  );

  // 10. Non-user package should be marked added
  const nonUserListRes = await request(
    "GET",
    `/admin/nonUserPackage?phoneNumber=${testPhone}`,
    auth
  );
  log(
    "Non-user package list after acceptance",
    nonUserListRes.status === 404,
    `status=${nonUserListRes.status} (404 expected when all packages consumed)`
  );

  // 11. Guest non-user package (no matching app user)
  const guestPhone = `0188${Date.now().toString().slice(-7)}`;
  const guestPkgRes = await request("POST", "/admin/nonUserPackage", {
    ...auth,
    body: {
      name: "Guest Only User",
      phoneNumber: guestPhone,
      pkgId: pkg._id,
      pkgStartDate: startDate,
      paymentMethod: "CASH",
      pendingDeduction: false,
    },
  });
  log(
    "Add guest non-user package",
    guestPkgRes.status === 200,
    `phone=${guestPhone}`
  );

  const guestListRes = await request(
    "GET",
    `/admin/nonUserPackage?phoneNumber=${guestPhone}`,
    auth
  );
  const guestPkgs = guestListRes.data?.data || [];
  log(
    "List guest non-user packages",
    guestListRes.status === 200 && guestPkgs.length > 0,
    `count=${guestPkgs.length}`
  );

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`${"=".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
