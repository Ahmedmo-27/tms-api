import {
  getPackageEndDate,
  isUnlimitedSpaceAccess,
  resolvePackageExpiryDays,
} from "./package";
import { formatInTimeZone } from "date-fns-tz";

// re-import from payment util for duration label tests
import { formatOpenGymDurationLabel as formatDuration } from "../utils/open-gym-payment-purpose";

describe("isUnlimitedSpaceAccess", () => {
  it("treats mix packages as time-based open gym (no session debit)", () => {
    expect(isUnlimitedSpaceAccess("MIXED")).toBe(true);
    expect(isUnlimitedSpaceAccess("OPEN_GYM")).toBe(true);
    expect(isUnlimitedSpaceAccess("SPACE_MEMBERSHIP")).toBe(true);
    expect(isUnlimitedSpaceAccess("ULTIMATE_MINDSPACER")).toBe(true);
  });

  it("does not treat class-only categories as unlimited space", () => {
    expect(isUnlimitedSpaceAccess("STUDIO")).toBe(false);
    expect(isUnlimitedSpaceAccess("FUNCTIONAL_TRAINING")).toBe(false);
    expect(isUnlimitedSpaceAccess("PERSONAL_TRAINING")).toBe(false);
  });
});

describe("resolvePackageExpiryDays", () => {
  it("uses expiryPeriod as the source of truth", () => {
    expect(resolvePackageExpiryDays({ expiryPeriod: 14 })).toBe(14);
    expect(resolvePackageExpiryDays({ expiryPeriod: 45 })).toBe(45);
    expect(resolvePackageExpiryDays({ expiryPeriod: 60 })).toBe(60);
  });
});

describe("getPackageEndDate", () => {
  it("computes end date from custom expiryPeriod days on the Cairo calendar", () => {
    const end = getPackageEndDate("2026-01-01", { expiryPeriod: 60 });
    expect(formatInTimeZone(end, "Africa/Cairo", "yyyy-MM-dd")).toBe(
      "2026-03-02",
    );
    expect(end.toISOString()).toBe("2026-03-02T12:00:00.000Z");
  });

  it("does not shift a June 2 start back to June 1 when computing end", () => {
    const end = getPackageEndDate("2025-06-02", { expiryPeriod: 30 });
    expect(formatInTimeZone(end, "Africa/Cairo", "yyyy-MM-dd")).toBe(
      "2025-07-02",
    );
    expect(end.toISOString().slice(0, 10)).toBe("2025-07-02");
  });
});

describe("formatOpenGymDurationLabel", () => {
  it("formats weeks and months from day counts", () => {
    expect(formatDuration(14)).toBe("2 weeks");
    expect(formatDuration(90)).toBe("3 months");
    expect(formatDuration(10)).toBe("10 days");
  });
});
