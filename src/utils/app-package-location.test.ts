import { Types } from "mongoose";
import {
  clearMainLocationCache,
  resolveAppPackageLocationId,
  resolveSessionPaymentLocationId,
} from "./app-package-location";
import { getMatchaLocationId } from "./matcha-branch";
import Location from "../models/location";

jest.mock("./matcha-branch", () => ({
  getMatchaLocationId: jest.fn(),
}));

jest.mock("../models/location");

describe("resolveAppPackageLocationId", () => {
  const matchaId = new Types.ObjectId().toString();
  const pkgLocationId = new Types.ObjectId();
  const mainId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    clearMainLocationCache();
    delete process.env.MAIN_LOCATION_ID;
    delete process.env.CAIRO_LOCATION_ID;
  });

  it("uses Matcha for pending members", async () => {
    (getMatchaLocationId as jest.Mock).mockResolvedValue(matchaId);

    await expect(
      resolveAppPackageLocationId({ locationId: pkgLocationId }, true),
    ).resolves.toBe(matchaId);
  });

  it("uses package.locationId for regular members when set", async () => {
    await expect(
      resolveAppPackageLocationId({ locationId: pkgLocationId }, false),
    ).resolves.toBe(pkgLocationId.toString());
  });

  it("falls back to main/Cairo branch when package has no locationId", async () => {
    process.env.MAIN_LOCATION_ID = mainId.toString();

    await expect(
      resolveAppPackageLocationId({ locationId: null }, false),
    ).resolves.toBe(mainId.toString());
  });

  it("looks up The Mind Space when no env and no package location", async () => {
    (Location.findOne as jest.Mock).mockResolvedValueOnce({ _id: mainId });

    await expect(
      resolveAppPackageLocationId({}, false),
    ).resolves.toBe(mainId.toString());
  });

  it("throws when pending and Matcha is missing", async () => {
    (getMatchaLocationId as jest.Mock).mockResolvedValue(null);

    await expect(
      resolveAppPackageLocationId({}, true),
    ).rejects.toMatchObject({ code: "MATCHA_BRANCH_NOT_CONFIGURED" });
  });

  it("throws when no branch can be resolved", async () => {
    (Location.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      resolveAppPackageLocationId({ locationId: null }, false),
    ).rejects.toMatchObject({ code: "BRANCH_REQUIRED" });
  });

  it("prefers package location over main branch for open-gym style packs", async () => {
    process.env.MAIN_LOCATION_ID = mainId.toString();
    const openGymLocation = new Types.ObjectId();

    await expect(
      resolveAppPackageLocationId({ locationId: openGymLocation }, false),
    ).resolves.toBe(openGymLocation.toString());
  });

  it("resolves distinct branches for two catalog packages", async () => {
    const cairoPkgLoc = new Types.ObjectId();
    const matchaPkgLoc = new Types.ObjectId();

    await expect(
      resolveAppPackageLocationId({ locationId: cairoPkgLoc }, false),
    ).resolves.toBe(cairoPkgLoc.toString());
    await expect(
      resolveAppPackageLocationId({ locationId: matchaPkgLoc }, false),
    ).resolves.toBe(matchaPkgLoc.toString());
  });
});

describe("resolveSessionPaymentLocationId", () => {
  const sessionLoc = new Types.ObjectId();
  const classLoc = new Types.ObjectId();
  const mainId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    clearMainLocationCache();
    delete process.env.MAIN_LOCATION_ID;
    delete process.env.CAIRO_LOCATION_ID;
  });

  it("prefers session.locationId", async () => {
    await expect(
      resolveSessionPaymentLocationId({
        locationId: sessionLoc,
        cid: { locations: [classLoc] },
      }),
    ).resolves.toBe(sessionLoc.toString());
  });

  it("falls back to first class.locations entry", async () => {
    await expect(
      resolveSessionPaymentLocationId({
        locationId: null,
        cid: { locations: [classLoc] },
      }),
    ).resolves.toBe(classLoc.toString());
  });

  it("falls back to main branch when session and class lack location", async () => {
    process.env.MAIN_LOCATION_ID = mainId.toString();

    await expect(
      resolveSessionPaymentLocationId({
        locationId: null,
        cid: { locations: [] },
      }),
    ).resolves.toBe(mainId.toString());
  });

  it("throws BRANCH_REQUIRED when nothing resolves", async () => {
    (Location.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      resolveSessionPaymentLocationId({ locationId: undefined, cid: null }),
    ).rejects.toMatchObject({ code: "BRANCH_REQUIRED" });
  });
});
