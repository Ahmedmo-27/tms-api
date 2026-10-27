import {
  buildFinanceRange,
  paymentSegment,
  percentChange,
  perSessionValue,
  previousRange,
  rangeBuckets,
} from "./finance-range";

describe("buildFinanceRange", () => {
  it("builds Cairo day bounds and daily buckets for short ranges", () => {
    const range = buildFinanceRange({ startDate: "2026-09-01", endDate: "2026-09-03" }, null);
    // Cairo is UTC+3 in September (DST)
    expect(range.start.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-03T21:00:00.000Z");
    expect(range.granularity).toBe("day");
    expect(rangeBuckets(range)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("swaps reversed dates and uses monthly buckets for long ranges", () => {
    const range = buildFinanceRange({ startDate: "2026-06-30", endDate: "2026-01-01" }, "abc");
    expect(range.startKey).toBe("2026-01-01");
    expect(range.endKey).toBe("2026-06-30");
    expect(range.locationId).toBe("abc");
    expect(range.granularity).toBe("month");
    expect(rangeBuckets(range)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("rejects malformed dates and ranges over three years", () => {
    expect(() => buildFinanceRange({ startDate: "01/09/2026" }, null)).toThrow();
    expect(() => buildFinanceRange({ startDate: "2020-01-01", endDate: "2026-01-01" }, null)).toThrow();
  });

  it("defaults to the current month", () => {
    const range = buildFinanceRange({}, null);
    expect(range.startKey.endsWith("-01")).toBe(true);
    expect(range.startKey <= range.endKey).toBe(true);
  });
});

describe("previousRange", () => {
  it("returns the equal-length period right before", () => {
    const range = buildFinanceRange({ startDate: "2026-09-11", endDate: "2026-09-20" }, null);
    const prev = previousRange(range);
    expect(prev.end.getTime()).toBe(range.start.getTime());
    expect(prev.startKey).toBe("2026-09-01");
    expect(prev.endKey).toBe("2026-09-10");
    expect(rangeBuckets(prev)).toHaveLength(10);
  });
});

describe("paymentSegment", () => {
  it("splits packages by category and drop-ins by type", () => {
    expect(paymentSegment("PACKAGE", "STUDIO")).toBe("STUDIO");
    expect(paymentSegment("NON_USER_PACKAGE", "PERSONAL_TRAINING")).toBe("PERSONAL_TRAINING");
    expect(paymentSegment("PACKAGE", undefined)).toBe("UNCATEGORIZED_PACKAGE");
    expect(paymentSegment("DROPIN")).toBe("DROPIN");
    expect(paymentSegment("NON_USER_BOOKING")).toBe("NON_MEMBER_DROPIN");
    expect(paymentSegment("WALKIN")).toBe("WALKIN");
    expect(paymentSegment("SOMETHING")).toBe("OTHER");
  });

  it("splits personal training into offline and online by package name", () => {
    expect(paymentSegment("PACKAGE", "PERSONAL_TRAINING", "10 PT with Salma")).toBe(
      "PERSONAL_TRAINING",
    );
    expect(
      paymentSegment("PACKAGE", "PERSONAL_TRAINING", "1 month online PT with Salma"),
    ).toBe("ONLINE_PERSONAL_TRAINING");
    expect(
      paymentSegment("NON_USER_PACKAGE", "PERSONAL_TRAINING", "8 Online Personal Training"),
    ).toBe("ONLINE_PERSONAL_TRAINING");
    expect(paymentSegment("PACKAGE", "PERSONAL_TRAINING")).toBe("PERSONAL_TRAINING");
    // "online" on a non-PT package stays in its own category.
    expect(paymentSegment("PACKAGE", "STUDIO", "Online Studio")).toBe("STUDIO");
  });
});

describe("helpers", () => {
  it("computes per-session value only for limited packages", () => {
    expect(perSessionValue({ price: 1200, numberOfSessions: 8 })).toBe(150);
    expect(perSessionValue({ price: 1200, numberOfSessions: 10000 })).toBeNull();
    expect(perSessionValue(null)).toBeNull();
  });

  it("computes percent change and handles a zero base", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});
