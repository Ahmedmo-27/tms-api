/**
 * Sales attribution end to end, against a real mongod.
 *
 * The unit suite mocks Mongo, so the aggregation itself is only proven here:
 * which sold packages are listed, how branch scoping is enforced per role, and
 * that an assignment actually lands on the right member package. Legacy rows
 * are part of the contract — real data holds mixed-case statuses and packages
 * saved before `soldBy` existed — so both shapes are seeded on purpose.
 */
import mongoose, { Types } from "mongoose";
import {
  api,
  bearer,
  clearDb,
  startHarness,
  stopHarness,
} from "./harness";

jest.setTimeout(180000);

/* eslint-disable @typescript-eslint/no-require-imports */
const User = require("../../models/user").default;
const Package = require("../../models/package").default;
const Location = require("../../models/location").default;
/* eslint-enable @typescript-eslint/no-require-imports */

const PASSWORD = "SalesSuite123!";

type Staff = { id: string; token: string };

let branchA: string;
let branchB: string;
let catalogPkgA: string;
let catalogPkgB: string;

let management: Staff;
let branchAdminA: Staff;
let salesManager: Staff;
let accountant: Staff;
let salesAccount: Staff;
let otherSalesAccount: Staff;

/** Member package ids, by the name they were seeded under. */
const soldPackageIds: Record<string, string> = {};
let memberAUid: string;
let memberMultiBranchUid: string;

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `0111${String(1000000 + phoneSeq)}`;
}

/** Creates a staff account and logs it in, returning its id and bearer token. */
async function staff(role: string, locationId?: string): Promise<Staff> {
  const phoneNumber = nextPhone();
  const user = await User.create({
    name: `${role} tester`,
    email: `${role}-${phoneNumber}@sales.local`,
    phoneNumber,
    password: PASSWORD,
    role,
    ...(locationId ? { locationId: new Types.ObjectId(locationId) } : {}),
  });
  const login = await api()
    .post("/auth/login")
    .send({ phoneNumber, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed for ${role}: ${login.status} ${login.text}`);
  }
  return { id: String(user._id), token: login.body.data.token };
}

/**
 * Seeds one member holding the given packages. Written through the raw
 * collection so legacy shapes (mixed-case status, no `soldBy` field) can be
 * reproduced exactly as they exist in production data.
 */
async function seedMember(
  packages: Array<{
    key: string;
    name: string;
    pkgId: string;
    status: string;
    locationId: string | null;
    soldBy?: string;
  }>,
): Promise<string> {
  const phoneNumber = nextPhone();
  const user = await User.create({
    name: `Member ${phoneNumber}`,
    email: `member-${phoneNumber}@sales.local`,
    phoneNumber,
    password: PASSWORD,
    role: "member",
  });

  const docs = packages.map((pkg) => {
    const _id = new Types.ObjectId();
    soldPackageIds[pkg.key] = String(_id);
    return {
      _id,
      pkgId: new Types.ObjectId(pkg.pkgId),
      name: pkg.name,
      pkgStartDate: new Date("2026-10-01T12:00:00.000Z"),
      pkgEndDate: new Date("2026-11-01T12:00:00.000Z"),
      status: pkg.status,
      remainingClasses: 8,
      locationId: pkg.locationId ? new Types.ObjectId(pkg.locationId) : null,
      // soldBy is deliberately absent unless given — that is the legacy shape.
      ...(pkg.soldBy ? { soldBy: new Types.ObjectId(pkg.soldBy) } : {}),
    };
  });

  await mongoose.connection.db!.collection("members").insertOne({
    uid: user._id,
    packages: docs,
    bookings: [],
    attendance: [],
    ptAttendance: [],
    isActive: true,
  });

  return String(user._id);
}

beforeAll(async () => {
  await startHarness();
  await clearDb();

  const [locA, locB] = await Location.create([
    { branchName: "Cairo", location: "Cairo", locationUrl: "https://a.test" },
    { branchName: "NorthCoast", location: "NC", locationUrl: "https://b.test" },
  ]);
  branchA = String(locA._id);
  branchB = String(locB._id);

  const [pkgA, pkgB] = await Package.create([
    {
      name: "Studio 10",
      numberOfSessions: 10,
      price: 5000,
      expiryPeriod: 45,
      category: "STUDIO",
    },
    {
      name: "PT 10",
      numberOfSessions: 10,
      price: 9000,
      expiryPeriod: 60,
      category: "PERSONAL_TRAINING",
    },
  ]);
  catalogPkgA = String(pkgA._id);
  catalogPkgB = String(pkgB._id);

  management = await staff("management");
  branchAdminA = await staff("branch_admin", branchA);
  salesManager = await staff("sales_manager");
  accountant = await staff("accountant");
  salesAccount = await staff("sales");
  otherSalesAccount = await staff("sales");

  memberAUid = await seedMember([
    { key: "a-active", name: "Studio 10", pkgId: catalogPkgA, status: "ACTIVE", locationId: branchA },
    // Legacy mixed-case status: still a sold package, must be listed.
    { key: "a-legacy-case", name: "PT 10", pkgId: catalogPkgB, status: "Active", locationId: branchA },
    // Removed from the member in either casing: never a sold package.
    { key: "a-deleted", name: "Studio 10", pkgId: catalogPkgA, status: "DELETED", locationId: branchA },
    { key: "a-deleted-legacy", name: "PT 10", pkgId: catalogPkgB, status: "Deleted", locationId: branchA },
  ]);
  await seedMember([
    { key: "b-active", name: "Studio 10", pkgId: catalogPkgA, status: "ACTIVE", locationId: branchB },
    // No branch recorded — legacy rows exist like this.
    { key: "b-nobranch", name: "PT 10", pkgId: catalogPkgB, status: "COMPLETED", locationId: null },
  ]);
  memberMultiBranchUid = await seedMember([
    {
      key: "multi-a",
      name: "Studio 10",
      pkgId: catalogPkgA,
      status: "ACTIVE",
      locationId: branchA,
    },
    {
      key: "multi-b",
      name: "Studio 10",
      pkgId: catalogPkgA,
      status: "ACTIVE",
      locationId: branchB,
    },
  ]);
});

afterAll(async () => {
  await stopHarness();
});

/** Resets every attribution between tests so each one starts uncredited. */
beforeEach(async () => {
  await mongoose.connection.db!.collection("members").updateMany(
    {},
    {
      $unset: {
        salesRep: "",
        salesRepAssignedAt: "",
        salesRepAssignedBy: "",
        soldBy: "",
        soldByAssignedAt: "",
        soldByAssignedBy: "",
        "packages.$[].soldBy": "",
        "packages.$[].soldByAssignedAt": "",
        "packages.$[].soldByAssignedBy": "",
      },
    },
  );
});

const listAs = (who: Staff, query = "") =>
  api().get(`/sales/packages${query}`).set(bearer(who.token));

const assignAs = (who: Staff, memberPackageId: string, soldBy: string | null) =>
  api()
    .patch(`/sales/packages/${memberPackageId}/seller`)
    .set(bearer(who.token))
    .send({ soldBy });

const assignMemberAs = (who: Staff, uid: string, soldBy: string | null) =>
  api()
    .patch(`/sales/members/${uid}/seller`)
    .set(bearer(who.token))
    .send({ soldBy });

/** The shape the sales endpoints return, as these assertions read it. */
type SoldPackageRow = {
  memberPackageId: string;
  uid: string;
  memberName: string;
  memberPhone: string;
  packageName: string;
  category: string;
  branchName: string;
  status: string;
  soldBy: { _id: string; name: string; role: string } | null;
  soldByAssignedAt: string | null;
  soldByAssignedBy: { _id: string; name: string } | null;
};

type ListBody = {
  data: {
    rows: SoldPackageRow[];
    total: number;
    totalPages: number;
    summary: {
      total: number;
      assigned: number;
      unassigned: number;
      bySeller: { salesAccountId: string; name: string; count: number }[];
    };
  };
};

type AccountsBody = {
  data: { accounts: { _id: string; name: string; role: string }[] };
};

const body = (res: { body: unknown }) => res.body as ListBody;

const ids = (res: { body: unknown }) =>
  body(res).data.rows.map((row) => row.memberPackageId);

const rowFor = (payload: ListBody, memberPackageId: string) =>
  payload.data.rows.find((row) => row.memberPackageId === memberPackageId)!;

describe("GET /sales/packages — what counts as a sold package", () => {
  it("lists live packages and never the removed ones, in either casing", async () => {
    const res = await listAs(management, "?limit=100");

    expect(res.status).toBe(200);
    const listed = ids(res);
    expect(listed).toContain(soldPackageIds["a-active"]);
    expect(listed).toContain(soldPackageIds["a-legacy-case"]);
    expect(listed).toContain(soldPackageIds["b-active"]);
    expect(listed).toContain(soldPackageIds["b-nobranch"]);
    expect(listed).not.toContain(soldPackageIds["a-deleted"]);
    expect(listed).not.toContain(soldPackageIds["a-deleted-legacy"]);
    expect(res.body.data.total).toBe(6);
  });

  it("carries the member, package, branch and status of each sale", async () => {
    const res = await listAs(management, "?limit=100");
    const row = rowFor(body(res), soldPackageIds["a-active"]);

    expect(row.uid).toBe(memberAUid);
    expect(row.memberName).toMatch(/^Member /);
    expect(row.memberPhone).toMatch(/^0111/);
    expect(row.packageName).toBe("Studio 10");
    expect(row.category).toBe("STUDIO");
    expect(row.branchName).toBe("Cairo");
    expect(row.status).toBe("ACTIVE");
    expect(row.soldBy).toBeNull();
  });

  it("starts every package uncredited and counts them in the summary", async () => {
    const res = await listAs(management, "?limit=100");

    expect(res.body.data.summary).toMatchObject({
      total: 6,
      assigned: 0,
      unassigned: 6,
      bySeller: [],
    });
  });

  it("paginates", async () => {
    const first = await listAs(management, "?limit=1&page=1");
    const second = await listAs(management, "?limit=1&page=2");

    expect(first.body.data.rows).toHaveLength(1);
    expect(second.body.data.rows).toHaveLength(1);
    expect(first.body.data.rows[0].memberPackageId).not.toBe(
      second.body.data.rows[0].memberPackageId,
    );
    expect(first.body.data.total).toBe(6);
    expect(first.body.data.totalPages).toBe(6);
  });

  it("searches by package name", async () => {
    const res = await listAs(management, "?limit=100&search=Studio");

    expect(
      body(res).data.rows.every((row) => row.packageName === "Studio 10"),
    ).toBe(true);
    expect(res.body.data.rows).toHaveLength(4);
  });

  it("searches by member phone, across that member's packages", async () => {
    const all = await listAs(management, "?limit=100");
    const phone = rowFor(body(all), soldPackageIds["a-active"]).memberPhone;

    const res = await listAs(management, `?limit=100&search=${phone}`);

    const listed = ids(res);
    expect(listed).toContain(soldPackageIds["a-active"]);
    expect(listed).toContain(soldPackageIds["a-legacy-case"]);
    expect(listed).not.toContain(soldPackageIds["b-active"]);
  });
});

describe("GET /sales/packages — branch scoping", () => {
  it("lets management filter to one branch", async () => {
    const res = await listAs(management, `?limit=100&locationId=${branchA}`);

    const listed = ids(res);
    expect(listed).toContain(soldPackageIds["a-active"]);
    expect(listed).not.toContain(soldPackageIds["b-active"]);
    expect(res.body.data.total).toBe(3);
  });

  it("pins branch_admin to its own branch and ignores a branch it passes", async () => {
    const res = await listAs(branchAdminA, `?limit=100&locationId=${branchB}`);

    const listed = ids(res);
    expect(listed).toContain(soldPackageIds["a-active"]);
    expect(listed).not.toContain(soldPackageIds["b-active"]);
    expect(listed).not.toContain(soldPackageIds["b-nobranch"]);
  });

  it("shows the sales_manager every branch, including sales with no branch", async () => {
    const res = await listAs(salesManager, "?limit=100");

    expect(res.body.data.total).toBe(6);
    expect(rowFor(body(res), soldPackageIds["b-nobranch"]).branchName).toBe("");
  });
});

describe("PATCH /sales/packages/:id/seller", () => {
  it("credits a sale and records who set it", async () => {
    const res = await assignAs(
      salesManager,
      soldPackageIds["a-active"],
      salesAccount.id,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.soldBy._id).toBe(salesAccount.id);

    const listed = await listAs(salesManager, "?limit=100");
    const row = rowFor(body(listed), soldPackageIds["a-active"]);
    expect(row.soldBy?._id).toBe(salesAccount.id);
    expect(row.soldByAssignedBy?._id).toBe(salesManager.id);
    expect(row.soldByAssignedAt).toBeTruthy();
  });

  it("credits every non-deleted package on the member and sets member.soldBy", async () => {
    await assignAs(salesManager, soldPackageIds["a-active"], salesAccount.id);

    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["a-legacy-case"]).soldBy?._id).toBe(
      salesAccount.id,
    );
    const memberDoc = await mongoose.connection.db!.collection("members").findOne({
      uid: new Types.ObjectId(memberAUid),
    });
    expect(String(memberDoc?.soldBy)).toBe(salesAccount.id);
    const deletedPkg = memberDoc!.packages.find(
      (p: { _id: Types.ObjectId }) => String(p._id) === soldPackageIds["a-deleted"],
    );
    const deletedLegacyPkg = memberDoc!.packages.find(
      (p: { _id: Types.ObjectId }) =>
        String(p._id) === soldPackageIds["a-deleted-legacy"],
    );
    expect(deletedPkg?.soldBy).toBeFalsy();
    expect(deletedLegacyPkg?.soldBy).toBeFalsy();
  });

  it("moves a sale from one salesperson to another", async () => {
    await assignAs(salesManager, soldPackageIds["a-active"], salesAccount.id);
    const res = await assignAs(
      salesManager,
      soldPackageIds["a-active"],
      otherSalesAccount.id,
    );

    expect(res.status).toBe(200);
    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["a-active"]).soldBy?._id).toBe(
      otherSalesAccount.id,
    );
  });

  it("clears an attribution when soldBy is null", async () => {
    await assignAs(salesManager, soldPackageIds["a-active"], salesAccount.id);
    const res = await assignAs(salesManager, soldPackageIds["a-active"], null);

    expect(res.status).toBe(200);
    expect(res.body.data.soldBy).toBeNull();
    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["a-active"]).soldBy).toBeNull();
    expect(rowFor(body(listed), soldPackageIds["a-legacy-case"]).soldBy).toBeNull();
    const memberDoc = await mongoose.connection.db!.collection("members").findOne({
      uid: new Types.ObjectId(memberAUid),
    });
    expect(memberDoc?.soldBy).toBeFalsy();
  });

  it("refuses an account that is not a sales account", async () => {
    const res = await assignAs(
      salesManager,
      soldPackageIds["a-active"],
      management.id,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_A_SALES_ACCOUNT");
  });

  it("refuses an id that matches no account", async () => {
    const res = await assignAs(
      salesManager,
      soldPackageIds["a-active"],
      new Types.ObjectId().toString(),
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SALES_ACCOUNT_NOT_FOUND");
  });

  it("refuses a malformed sold package id", async () => {
    const res = await assignAs(salesManager, "not-an-id", salesAccount.id);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_MEMBER_PACKAGE_ID");
  });

  it("404s on a sold package that does not exist", async () => {
    const res = await assignAs(
      salesManager,
      new Types.ObjectId().toString(),
      salesAccount.id,
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SOLD_PACKAGE_NOT_FOUND");
  });

  it("refuses a package that was removed from the member", async () => {
    const res = await assignAs(
      salesManager,
      soldPackageIds["a-deleted"],
      salesAccount.id,
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SOLD_PACKAGE_DELETED");
  });

  it("lets branch_admin credit its own branch's sale", async () => {
    const res = await assignAs(
      branchAdminA,
      soldPackageIds["a-active"],
      salesAccount.id,
    );

    expect(res.status).toBe(200);
  });

  it("updates every non-deleted package and member.soldBy for branch_admin on multi-branch members", async () => {
    const res = await assignAs(
      branchAdminA,
      soldPackageIds["multi-a"],
      salesAccount.id,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.packagesUpdated).toBe(2);

    const memberDoc = await mongoose.connection.db!.collection("members").findOne({
      uid: new Types.ObjectId(memberMultiBranchUid),
    });
    expect(String(memberDoc?.soldBy)).toBe(salesAccount.id);

    const branchAPkg = memberDoc!.packages.find(
      (p: { _id: Types.ObjectId }) => String(p._id) === soldPackageIds["multi-a"],
    );
    const branchBPkg = memberDoc!.packages.find(
      (p: { _id: Types.ObjectId }) => String(p._id) === soldPackageIds["multi-b"],
    );
    expect(String(branchAPkg?.soldBy)).toBe(salesAccount.id);
    expect(String(branchBPkg?.soldBy)).toBe(salesAccount.id);
  });

  it("lets branch_admin credit starting from a package at another branch via direct id", async () => {
    const res = await assignAs(
      branchAdminA,
      soldPackageIds["b-active"],
      salesAccount.id,
    );

    expect(res.status).toBe(200);
    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["b-active"]).soldBy?._id).toBe(
      salesAccount.id,
    );
  });

  it("lets the accountant credit a sale at any branch — its one write", async () => {
    const own = await assignAs(
      accountant,
      soldPackageIds["b-active"],
      salesAccount.id,
    );

    expect(own.status).toBe(200);
    const listed = await listAs(accountant, "?limit=100");
    const row = rowFor(body(listed), soldPackageIds["b-active"]);
    expect(row.soldBy?._id).toBe(salesAccount.id);
    expect(row.soldByAssignedBy?._id).toBe(accountant.id);
  });
});

describe("GET /admin/member soldBy", () => {
  it("returns populated member.soldBy after assignment", async () => {
    await assignAs(salesManager, soldPackageIds["a-active"], salesAccount.id);
    const res = await api()
      .get(`/admin/member?uid=${memberAUid}`)
      .set(bearer(management.token));

    expect(res.status).toBe(200);
    const member = res.body.data.members[0];
    expect(member.soldBy._id).toBe(salesAccount.id);
    expect(member.soldBy.role).toBe("sales");
    expect(member.soldByAssignedBy?._id).toBe(salesManager.id);
    const activePkg = member.packages.find(
      (p: { _id: string }) => String(p._id) === soldPackageIds["a-active"],
    );
    expect(activePkg.soldBy._id).toBe(salesAccount.id);
  });
});

describe("filtering by salesperson", () => {
  beforeEach(async () => {
    await assignAs(salesManager, soldPackageIds["a-active"], salesAccount.id);
  });

  it("'unassigned' covers packages saved before the field existed", async () => {
    const res = await listAs(salesManager, "?limit=100&seller=unassigned");

    const listed = ids(res);
    expect(listed).not.toContain(soldPackageIds["a-active"]);
    expect(listed).not.toContain(soldPackageIds["a-legacy-case"]);
    expect(res.body.data.total).toBe(4);
  });

  it("'assigned' returns only credited sales", async () => {
    const res = await listAs(salesManager, "?limit=100&seller=assigned");

    const credited = res.body.data.rows.map(
      (row: { memberPackageId: string }) => row.memberPackageId,
    );
    expect(credited).toEqual(
      expect.arrayContaining([
        soldPackageIds["a-active"],
        soldPackageIds["a-legacy-case"],
      ]),
    );
    expect(credited).not.toContain(soldPackageIds["b-active"]);
    expect(credited).not.toContain(soldPackageIds["b-nobranch"]);
  });

  it("filters to one salesperson and counts them in the summary", async () => {
    const res = await listAs(salesManager, `?limit=100&seller=${salesAccount.id}`);

    const credited = res.body.data.rows.map(
      (row: { memberPackageId: string }) => row.memberPackageId,
    );
    expect(credited).toEqual(
      expect.arrayContaining([
        soldPackageIds["a-active"],
        soldPackageIds["a-legacy-case"],
      ]),
    );
    // The summary spans the whole selection, not just the filtered page.
    expect(res.body.data.summary.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data.summary.assigned).toBeGreaterThanOrEqual(2);
    expect(res.body.data.summary.unassigned).toBeGreaterThanOrEqual(1);
    const sellerRow = res.body.data.summary.bySeller.find(
      (row: { salesAccountId: string }) => row.salesAccountId === salesAccount.id,
    );
    expect(sellerRow?.count).toBeGreaterThanOrEqual(2);
  });

  it("rejects a malformed salesperson filter", async () => {
    const res = await listAs(salesManager, "?seller=../management");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SALES_ACCOUNT");
  });
});

describe("GET /sales/accounts", () => {
  it("returns the sales accounts a sale can be credited to, and nothing else", async () => {
    const res = await listAccounts(salesManager);

    expect(res.status).toBe(200);
    const accounts = (res.body as AccountsBody).data.accounts;
    expect(new Set(accounts.map((a) => a.role))).toEqual(
      new Set(["sales", "sales_manager"]),
    );
    const accountIds = accounts.map((a) => a._id);
    expect(accountIds).toContain(salesAccount.id);
    expect(accountIds).toContain(salesManager.id);
    expect(accountIds).not.toContain(accountant.id);
    expect(accountIds).not.toContain(management.id);
  });

  it("is readable by the front desk, which picks the seller at the till", async () => {
    const res = await listAccounts(branchAdminA);
    expect(res.status).toBe(200);
  });
});

function listAccounts(who: Staff) {
  return api().get("/sales/accounts").set(bearer(who.token));
}

describe("who may reach the sales endpoints at all", () => {
  it("rejects an anonymous caller", async () => {
    const res = await api().get("/sales/packages");
    expect(res.status).toBe(401);
  });

  it("admits the accountant, whose only write in this API is the attribution", async () => {
    const res = await listAs(accountant, "?limit=100");
    expect(res.status).toBe(200);
  });

  it("rejects a plain sales account — it is credited, it does not assign", async () => {
    const res = await listAs(salesAccount, "?limit=100");
    expect(res.status).toBe(403);
  });

  it("rejects a sales account trying to credit itself", async () => {
    const res = await assignAs(
      salesAccount,
      soldPackageIds["a-active"],
      salesAccount.id,
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /sales/members/:uid/seller", () => {
  it("links a sales rep to the member and marks all non-deleted packages as sold by them", async () => {
    const res = await assignMemberAs(salesManager, memberAUid, salesAccount.id);

    expect(res.status).toBe(200);
    expect(res.body.data.uid).toBe(memberAUid);
    expect(res.body.data.salesRep._id).toBe(salesAccount.id);

    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["a-active"]).soldBy?._id).toBe(
      salesAccount.id,
    );
    expect(rowFor(body(listed), soldPackageIds["a-legacy-case"]).soldBy?._id).toBe(
      salesAccount.id,
    );
  });

  it("clears the member's sales rep and package attributions when soldBy is null", async () => {
    await assignMemberAs(salesManager, memberAUid, salesAccount.id);
    const res = await assignMemberAs(salesManager, memberAUid, null);

    expect(res.status).toBe(200);
    expect(res.body.data.salesRep).toBeNull();

    const listed = await listAs(salesManager, "?limit=100");
    expect(rowFor(body(listed), soldPackageIds["a-active"]).soldBy).toBeNull();
    expect(rowFor(body(listed), soldPackageIds["a-legacy-case"]).soldBy).toBeNull();
  });
});
