import {
  OPEN_GYM_RENEWAL_DAYS,
  getPackageEndDate,
  resolvePackageExpiryDays,
} from "./package";

describe("resolvePackageExpiryDays", () => {
  it("uses expiryPeriod as the source of truth", () => {
    expect(resolvePackageExpiryDays({ expiryPeriod: 14 })).toBe(14);
    expect(resolvePackageExpiryDays({ expiryPeriod: 60 })).toBe(60);
    expect(resolvePackageExpiryDays({ expiryPeriod: 90 })).toBe(90);
  });
});

describe("OPEN_GYM_RENEWAL_DAYS", () => {
  it("covers weekly and monthly presets", () => {
    expect(OPEN_GYM_RENEWAL_DAYS.WEEKLY).toBe(7);
    expect(OPEN_GYM_RENEWAL_DAYS.BIWEEKLY).toBe(14);
    expect(OPEN_GYM_RENEWAL_DAYS.TRIWEEKLY).toBe(21);
    expect(OPEN_GYM_RENEWAL_DAYS.MONTHLY).toBe(30);
    expect(OPEN_GYM_RENEWAL_DAYS.BIMONTHLY).toBe(60);
    expect(OPEN_GYM_RENEWAL_DAYS.TRIMONTHLY).toBe(90);
  });
});

describe("getPackageEndDate", () => {
  it("computes end date from expiryPeriod days", () => {
    const start = "2026-01-01T00:00:00.000Z";
    const end = getPackageEndDate(start, {
      category: "OPEN_GYM",
      renewalPeriod: "BIMONTHLY",
      expiryPeriod: 60,
    });
    expect(end.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });
});
