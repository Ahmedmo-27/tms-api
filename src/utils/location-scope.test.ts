import { Types } from "mongoose";
import {
  attendanceEntryMatchesLocation,
  normalizeLocationIdRef,
} from "./location-scope";

describe("normalizeLocationIdRef", () => {
  const cairoId = new Types.ObjectId().toString();

  it("returns null for missing values", () => {
    expect(normalizeLocationIdRef(null)).toBeNull();
    expect(normalizeLocationIdRef(undefined)).toBeNull();
  });

  it("normalizes string and ObjectId refs", () => {
    expect(normalizeLocationIdRef(cairoId)).toBe(cairoId);
    expect(normalizeLocationIdRef(new Types.ObjectId(cairoId))).toBe(cairoId);
  });

  it("normalizes populated location documents", () => {
    const populated = {
      _id: new Types.ObjectId(cairoId),
      branchName: "Cairo",
    } as { _id: Types.ObjectId };
    expect(normalizeLocationIdRef(populated)).toBe(cairoId);
  });
});

describe("attendanceEntryMatchesLocation", () => {
  const cairoId = new Types.ObjectId().toString();
  const matchaId = new Types.ObjectId().toString();

  it("matches populated open gym rows for the target branch", () => {
    expect(
      attendanceEntryMatchesLocation(
        {
          locationId: {
            _id: new Types.ObjectId(cairoId),
          } as { _id: Types.ObjectId },
        },
        cairoId,
      ),
    ).toBe(true);
  });

  it("excludes populated rows from other branches", () => {
    expect(
      attendanceEntryMatchesLocation(
        {
          locationId: {
            _id: new Types.ObjectId(matchaId),
          } as { _id: Types.ObjectId },
        },
        cairoId,
      ),
    ).toBe(false);
  });

  it("keeps legacy rows without a location id", () => {
    expect(attendanceEntryMatchesLocation({}, cairoId)).toBe(true);
  });
});
