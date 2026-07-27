import { Types } from "mongoose";
import {
  LEGACY_OPEN_GYM_PAYLOAD,
  LEGACY_PT_PAYLOAD,
  parseScanPayload,
  isValidOpenGymLocationId,
} from "../utils/scan-payload";
import {
  memberPackageGrantsAccessAtLocation,
} from "../utils/open-gym-location";

describe("parseScanPayload", () => {
  const scheduledClassId = new Types.ObjectId().toString();

  it("detects legacy PT scans", () => {
    expect(parseScanPayload(LEGACY_PT_PAYLOAD)).toEqual({ type: "pt" });
  });

  it("detects branch PT scans", () => {
    const locationId = new Types.ObjectId().toString();
    expect(parseScanPayload(`pt:${locationId}`)).toEqual({
      type: "branch_pt",
      locationId,
    });
  });

  it("does not treat legacy PT as branch format", () => {
    expect(parseScanPayload("pt").type).toBe("pt");
  });

  it("detects legacy open gym scans", () => {
    expect(parseScanPayload(LEGACY_OPEN_GYM_PAYLOAD)).toEqual({
      type: "legacy_open_gym",
    });
  });

  it("detects branch open gym scans", () => {
    const locationId = new Types.ObjectId().toString();
    expect(parseScanPayload(`opengym:${locationId}`)).toEqual({
      type: "branch_open_gym",
      locationId,
    });
  });

  it("detects scheduled class scans", () => {
    expect(parseScanPayload(scheduledClassId)).toEqual({
      type: "scheduled_class",
      scheduledClassId,
    });
  });

  it("rejects unknown payloads", () => {
    expect(parseScanPayload("not-a-valid-scan")).toEqual({ type: "invalid" });
  });

  it("does not treat legacy open gym as branch format", () => {
    expect(parseScanPayload("opengym").type).toBe("legacy_open_gym");
  });
});

describe("isValidOpenGymLocationId", () => {
  it("accepts valid ObjectIds", () => {
    const locationId = new Types.ObjectId().toString();
    expect(isValidOpenGymLocationId(locationId)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isValidOpenGymLocationId("")).toBe(false);
    expect(isValidOpenGymLocationId("not-an-object-id")).toBe(false);
  });
});

describe("memberPackageGrantsAccessAtLocation", () => {
  const branchA = new Types.ObjectId();
  const branchB = new Types.ObjectId();

  it("allows access when member package is scoped to scanned branch", () => {
    expect(
      memberPackageGrantsAccessAtLocation(branchA, branchA, branchA.toString()),
    ).toBe(true);
  });

  it("denies access when member package is scoped to a different branch", () => {
    expect(
      memberPackageGrantsAccessAtLocation(branchA, branchA, branchB.toString()),
    ).toBe(false);
  });

  it("uses catalog package location when member package has no branch", () => {
    expect(
      memberPackageGrantsAccessAtLocation(null, branchA, branchA.toString()),
    ).toBe(true);
    expect(
      memberPackageGrantsAccessAtLocation(null, branchA, branchB.toString()),
    ).toBe(false);
  });
});
