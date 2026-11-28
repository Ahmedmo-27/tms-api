import { Types } from "mongoose";
import { SalesService } from "./sales-service";
import Member from "../models/member";
import Package from "../models/package";
import User from "../models/user";
import Location from "../models/location";
import { BadRequestError, NotFoundError } from "../core/ApiError";

jest.mock("../models/member");
jest.mock("../models/package");
jest.mock("../models/user");
jest.mock("../models/location");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

/** Thenable that also answers .lean(), like a Mongoose query. */
function resolved(value: unknown) {
  const query = Promise.resolve(value) as Promise<unknown> & {
    lean: () => Promise<unknown>;
    select: () => unknown;
    limit: () => unknown;
    sort: () => unknown;
    populate: () => unknown;
  };
  query.lean = () => Promise.resolve(value);
  query.select = () => query;
  query.limit = () => query;
  query.sort = () => query;
  query.populate = () => query;
  return query;
}

const salesAccountId = new Types.ObjectId();
const actorId = new Types.ObjectId();
const memberPackageId = new Types.ObjectId();
const branchA = new Types.ObjectId();
const branchB = new Types.ObjectId();

const salesAccount = {
  _id: salesAccountId,
  name: "Nour Sales",
  role: "sales",
};

function mockFindById(doc: unknown) {
  (User.findById as jest.Mock).mockReturnValue(resolved(doc));
}

const memberDocId = new Types.ObjectId();
const secondMemberPackageId = new Types.ObjectId();

/** A member holding one sold package, as assignSeller reads it. */
function memberWithPackage(
  overrides: Partial<{ status: string; locationId: Types.ObjectId | null }> = {},
  extraPackages: Array<{
    _id: Types.ObjectId;
    status: string;
    locationId?: Types.ObjectId | null;
  }> = [],
) {
  // locationId: undefined keeps branchA; null means "no branch recorded".
  return {
    _id: memberDocId,
    uid: new Types.ObjectId(),
    packages: [
      {
        _id: memberPackageId,
        status: overrides.status ?? "ACTIVE",
        locationId:
          overrides.locationId === undefined ? branchA : overrides.locationId,
      },
      ...extraPackages.map((pkg) => ({
        locationId: branchA,
        ...pkg,
      })),
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
});

describe("resolveSalesAccountId", () => {
  it("treats null, undefined and an empty string as 'no salesperson'", async () => {
    await expect(SalesService.resolveSalesAccountId(null)).resolves.toBeNull();
    await expect(
      SalesService.resolveSalesAccountId(undefined),
    ).resolves.toBeNull();
    await expect(SalesService.resolveSalesAccountId("")).resolves.toBeNull();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before touching the database", async () => {
    await expect(SalesService.resolveSalesAccountId("not-an-id")).rejects.toThrow(
      BadRequestError,
    );
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("rejects an id that matches no account", async () => {
    mockFindById(null);
    await expect(
      SalesService.resolveSalesAccountId(salesAccountId.toString()),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to credit a sale to a non-sales account", async () => {
    mockFindById({ _id: salesAccountId, role: "branch_admin" });
    await expect(
      SalesService.resolveSalesAccountId(salesAccountId.toString()),
    ).rejects.toThrow(BadRequestError);
  });

  it("accepts the sales and sales_manager roles", async () => {
    for (const role of ["sales", "sales_manager"]) {
      mockFindById({ _id: salesAccountId, role });
      await expect(
        SalesService.resolveSalesAccountId(salesAccountId.toString()),
      ).resolves.toEqual(salesAccountId);
    }
  });
});

describe("assignSeller", () => {
  it("credits a sold package to a sales account and records who set it", async () => {
    mockFindById(salesAccount);
    (Member.findOne as jest.Mock).mockReturnValue(resolved(memberWithPackage()));

    const result = await SalesService.assignSeller({
      memberPackageId: memberPackageId.toString(),
      soldBy: salesAccountId.toString(),
      actorId: actorId.toString(),
    });

    const [filter, update, options] = (Member.updateOne as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ _id: memberDocId });
    expect(update.$set.soldBy).toEqual(salesAccountId);
    expect(update.$set["packages.$[pkg].soldBy"]).toEqual(salesAccountId);
    expect(update.$set["packages.$[pkg].soldByAssignedBy"]).toEqual(actorId);
    expect(update.$set["packages.$[pkg].soldByAssignedAt"]).toBeInstanceOf(Date);
    expect(options.arrayFilters).toEqual([
      { "pkg.status": { $not: { $regex: "^deleted$", $options: "i" } } },
    ]);
    expect(result.soldBy).toEqual({
      _id: salesAccountId.toString(),
      name: "Nour Sales",
      role: "sales",
    });
    expect(result.packagesUpdated).toBe(1);
  });

  it("updates every non-deleted package and reports how many were touched", async () => {
    mockFindById(salesAccount);
    (Member.findOne as jest.Mock).mockReturnValue(
      resolved(
        memberWithPackage(
          {},
          [
            { _id: secondMemberPackageId, status: "ACTIVE" },
            { _id: new Types.ObjectId(), status: "DELETED" },
          ],
        ),
      ),
    );

    const result = await SalesService.assignSeller({
      memberPackageId: memberPackageId.toString(),
      soldBy: salesAccountId.toString(),
      actorId: actorId.toString(),
    });

    expect(result.packagesUpdated).toBe(2);
  });

  it("clears the attribution when soldBy is null", async () => {
    (Member.findOne as jest.Mock).mockReturnValue(resolved(memberWithPackage()));

    const result = await SalesService.assignSeller({
      memberPackageId: memberPackageId.toString(),
      soldBy: null,
      actorId: actorId.toString(),
    });

    const [, update] = (Member.updateOne as jest.Mock).mock.calls[0];
    expect(update.$set.soldBy).toBeNull();
    expect(update.$set["packages.$[pkg].soldBy"]).toBeNull();
    expect(result.soldBy).toBeNull();
  });

  it("rejects a malformed sold package id", async () => {
    await expect(
      SalesService.assignSeller({
        memberPackageId: "nope",
        soldBy: null,
        actorId: actorId.toString(),
      }),
    ).rejects.toThrow(BadRequestError);
    expect(Member.updateOne).not.toHaveBeenCalled();
  });

  it("throws when no member holds that sold package", async () => {
    (Member.findOne as jest.Mock).mockReturnValue(resolved(null));

    await expect(
      SalesService.assignSeller({
        memberPackageId: memberPackageId.toString(),
        soldBy: null,
        actorId: actorId.toString(),
      }),
    ).rejects.toThrow(NotFoundError);
    expect(Member.updateOne).not.toHaveBeenCalled();
  });

  it.each(["DELETED", "Deleted"])(
    "refuses a package that was removed from the member (%s)",
    async (status) => {
      (Member.findOne as jest.Mock).mockReturnValue(
        resolved(memberWithPackage({ status })),
      );

      await expect(
        SalesService.assignSeller({
          memberPackageId: memberPackageId.toString(),
          soldBy: null,
          actorId: actorId.toString(),
        }),
      ).rejects.toThrow(BadRequestError);
      expect(Member.updateOne).not.toHaveBeenCalled();
    },
  );

  it("updates every non-deleted package and member.soldBy for branch_admin", async () => {
    const otherBranchPkgId = new Types.ObjectId();
    mockFindById(salesAccount);
    (Member.findOne as jest.Mock).mockReturnValue(
      resolved(
        memberWithPackage({}, [
          { _id: otherBranchPkgId, status: "ACTIVE", locationId: branchB },
        ]),
      ),
    );

    const result = await SalesService.assignSeller({
      memberPackageId: memberPackageId.toString(),
      soldBy: salesAccountId.toString(),
      actorId: actorId.toString(),
      scopedLocationId: branchA.toString(),
    });

    expect(result.packagesUpdated).toBe(2);
    const [, update, options] = (Member.updateOne as jest.Mock).mock.calls[0];
    expect(update.$set.soldBy).toEqual(salesAccountId);
    expect(update.$set["packages.$[pkg].soldBy"]).toEqual(salesAccountId);
    expect(options.arrayFilters).toEqual([
      { "pkg.status": { $not: { $regex: "^deleted$", $options: "i" } } },
    ]);
  });

  it("lets branch_admin assign from a named package with no branch recorded", async () => {
    mockFindById(salesAccount);
    (Member.findOne as jest.Mock).mockReturnValue(
      resolved(memberWithPackage({ locationId: null })),
    );

    const result = await SalesService.assignSeller({
      memberPackageId: memberPackageId.toString(),
      soldBy: salesAccountId.toString(),
      actorId: actorId.toString(),
      scopedLocationId: branchA.toString(),
    });

    expect(result.packagesUpdated).toBe(1);
    expect(Member.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = (Member.updateOne as jest.Mock).mock.calls[0];
    expect(update.$set.soldBy).toEqual(salesAccountId);
  });
});

describe("listSoldPackages", () => {
  beforeEach(() => {
    (Member.aggregate as jest.Mock).mockResolvedValue([]);
    (User.find as jest.Mock).mockReturnValue(resolved([]));
    (Package.find as jest.Mock).mockReturnValue(resolved([]));
    (Location.find as jest.Mock).mockReturnValue(resolved([]));
  });

  /** The $match stages of the rows pipeline, in order. */
  function rowMatches() {
    const pipeline = (Member.aggregate as jest.Mock).mock.calls[0][0];
    return pipeline
      .filter((stage: Record<string, unknown>) => "$match" in stage)
      .map((stage: Record<string, unknown>) => stage.$match);
  }

  it("never lists packages that were removed from a member", async () => {
    await SalesService.listSoldPackages({ page: 1, limit: 25 });
    // Legacy rows use mixed case ("Deleted"), so the filter is case-insensitive.
    expect(rowMatches()[1]["packages.status"]).toEqual({
      $not: { $regex: "^deleted$", $options: "i" },
    });
  });

  it("matches packages saved before the field existed as 'not credited yet'", async () => {
    await SalesService.listSoldPackages({
      page: 1,
      limit: 25,
      seller: "unassigned",
    });
    // $in: [null] also matches a missing soldBy, unlike { soldBy: null }.
    expect(rowMatches()[2]).toEqual({ "packages.soldBy": { $in: [null] } });
  });

  it("filters to one sales account by id", async () => {
    await SalesService.listSoldPackages({
      page: 1,
      limit: 25,
      seller: salesAccountId.toString(),
    });
    expect(rowMatches()[2]).toEqual({ "packages.soldBy": salesAccountId });
  });

  it("rejects a malformed sales account filter", async () => {
    await expect(
      SalesService.listSoldPackages({
        page: 1,
        limit: 25,
        seller: "../management",
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("scopes to a branch on the string form of the id, for legacy rows", async () => {
    await SalesService.listSoldPackages({
      page: 1,
      limit: 25,
      locationId: branchA.toString(),
    });
    expect(rowMatches()[1].$expr).toEqual({
      $eq: [{ $toString: "$packages.locationId" }, branchA.toString()],
    });
  });

  it("reports an empty page and summary when nothing matches", async () => {
    const result = await SalesService.listSoldPackages({ page: 1, limit: 25 });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.summary).toEqual({
      total: 0,
      assigned: 0,
      unassigned: 0,
      bySeller: [],
    });
  });

  it("splits the summary between credited and uncredited sales", async () => {
    (Member.aggregate as jest.Mock)
      .mockResolvedValueOnce([{ rows: [], total: [{ count: 0 }] }])
      .mockResolvedValueOnce([
        { _id: null, count: 4 },
        { _id: salesAccountId, count: 6 },
      ]);
    (User.find as jest.Mock).mockReturnValue(resolved([salesAccount]));

    const result = await SalesService.listSoldPackages({ page: 1, limit: 25 });

    expect(result.summary.total).toBe(10);
    expect(result.summary.assigned).toBe(6);
    expect(result.summary.unassigned).toBe(4);
    expect(result.summary.bySeller).toEqual([
      {
        salesAccountId: salesAccountId.toString(),
        name: "Nour Sales",
        count: 6,
      },
    ]);
  });
});
