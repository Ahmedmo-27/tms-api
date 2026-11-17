import type { Request, Response } from "express";
import { Types } from "mongoose";

jest.mock("../../models/package", () => {
  const Package = {
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  return { __esModule: true, default: Package, isUnlimitedSpaceAccess: jest.fn() };
});

import Package from "../../models/package";
import { updatePackage } from "./package-controller";

const PackageMock = Package as unknown as {
  findById: jest.Mock;
  findOne: jest.Mock;
  findByIdAndUpdate: jest.Mock;
};

const CAIRO = new Types.ObjectId("69ec4abad8394559ce7ca77c");
const PKG_ID = "6a47f348b71a5d31d730e735";

// Mirrors production: several OPEN_GYM durations at one branch share the name
// "Space membership", so a duplicate always exists for any of them.
const existingPkg = {
  _id: new Types.ObjectId(PKG_ID),
  name: "Space membership",
  category: "OPEN_GYM",
  price: 3000,
  expiryPeriod: 30,
  numberOfSessions: 10000,
  locationId: CAIRO,
  opensClasses: [],
};
const sibling = { ...existingPkg, _id: new Types.ObjectId(), price: 7200, expiryPeriod: 90 };

// The dashboard edit form resends every field, not just the changed one.
const fullFormBody = (overrides: Record<string, unknown> = {}) => ({
  name: "Space membership",
  category: "OPEN_GYM",
  numberOfSessions: "10000",
  expiryPeriod: "30",
  price: "2750",
  notes: "",
  opensClasses: [],
  classRestrictions: [],
  ...overrides,
});

async function callUpdate(body: Record<string, unknown>) {
  const req = { params: { id: PKG_ID }, body } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
  const next = jest.fn();
  await updatePackage(req, res, next);
  return { res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  PackageMock.findById.mockResolvedValue(existingPkg);
  PackageMock.findOne.mockResolvedValue(sibling);
  PackageMock.findByIdAndUpdate.mockImplementation(async (_id: string, update: Record<string, unknown>) => ({
    ...existingPkg,
    ...update,
  }));
});

describe("updatePackage duplicate-name check", () => {
  it("lets a price change through when other packages already share the name", async () => {
    const { res, next } = await callUpdate(fullFormBody());

    expect(next).not.toHaveBeenCalled();
    expect(PackageMock.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(PackageMock.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [updatedId, update] = PackageMock.findByIdAndUpdate.mock.calls[0];
    expect(updatedId).toBe(PKG_ID);
    expect(Number(update.price)).toBe(2750);
  });

  it("treats case and surrounding whitespace in the resent name as unchanged", async () => {
    const { next } = await callUpdate(fullFormBody({ name: "  space MEMBERSHIP " }));

    expect(next).not.toHaveBeenCalled();
    expect(PackageMock.findOne).not.toHaveBeenCalled();
    expect(PackageMock.findByIdAndUpdate).toHaveBeenCalledWith(
      PKG_ID,
      expect.objectContaining({ name: "space MEMBERSHIP" }),
      { new: true },
    );
  });

  it("still rejects a rename onto a name that already exists", async () => {
    PackageMock.findById.mockResolvedValue({ ...existingPkg, name: "Space membership 1 month" });

    const { next } = await callUpdate(fullFormBody({ name: "Space membership" }));

    expect(PackageMock.findOne).toHaveBeenCalledTimes(1);
    const query = PackageMock.findOne.mock.calls[0][0];
    expect(query._id).toEqual({ $ne: new Types.ObjectId(PKG_ID) });
    expect(String(query.locationId)).toBe(String(CAIRO));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "PACKAGE_ALREADY_EXISTS" }));
    expect(PackageMock.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("re-checks when the category changes", async () => {
    PackageMock.findOne.mockResolvedValue(null);

    const { next } = await callUpdate(fullFormBody({ category: "STUDIO" }));

    expect(PackageMock.findOne).toHaveBeenCalledTimes(1);
    expect(PackageMock.findOne.mock.calls[0][0].category).toBe("STUDIO");
    expect(next).not.toHaveBeenCalled();
  });
});
