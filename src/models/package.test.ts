import {
  getPackageEndDate,
  resolvePackageExpiryDays,
} from "./package";

// re-import from payment util for duration label tests
import { formatOpenGymDurationLabel as formatDuration } from "../utils/open-gym-payment-purpose";

describe("resolvePackageExpiryDays", () => {
  it("uses expiryPeriod as the source of truth", () => {
    expect(resolvePackageExpiryDays({ expiryPeriod: 14 })).toBe(14);
    expect(resolvePackageExpiryDays({ expiryPeriod: 45 })).toBe(45);
    expect(resolvePackageExpiryDays({ expiryPeriod: 60 })).toBe(60);
  });
});

describe("getPackageEndDate", () => {
  it("computes end date from custom expiryPeriod days", () => {
    const start = "2026-01-01T00:00:00.000Z";
    const end = getPackageEndDate(start, { expiryPeriod: 60 });
    expect(end.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });
});

describe("formatOpenGymDurationLabel", () => {
  it("formats weeks and months from day counts", () => {
    expect(formatDuration(14)).toBe("2 weeks");
    expect(formatDuration(90)).toBe("3 months");
    expect(formatDuration(10)).toBe("10 days");
  });
});
