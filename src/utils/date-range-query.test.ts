import { buildCairoDateRangeQuery } from "./date-range-query";
import { cairoMonthRange, startOfDateCairo } from "./timezone";

type Range = { $gte: Date; $lt: Date };

function range(
  dateString?: string,
  month?: number,
  year?: number,
): Range | undefined {
  const query = buildCairoDateRangeQuery(
    "paymentTime",
    dateString,
    month,
    year,
  );
  return query.paymentTime as Range | undefined;
}

function covers(window: Range | undefined, instant: Date): boolean {
  if (!window) return false;
  return instant >= window.$gte && instant < window.$lt;
}

describe("buildCairoDateRangeQuery day windows", () => {
  it("covers a payment stamped at Cairo midnight of the requested day", () => {
    // Sheet commits stamp paymentTime at Cairo midnight. Cairo is ahead of UTC,
    // so that instant lands on the previous UTC day — exactly what the old
    // UTC-bucketed window missed.
    const cairoMidnight = startOfDateCairo("2026-08-21");
    expect(cairoMidnight.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(covers(range("2026-08-21"), cairoMidnight)).toBe(true);
  });

  it("does not leak that payment into the previous day", () => {
    const cairoMidnight = startOfDateCairo("2026-08-21");
    expect(covers(range("2026-08-20"), cairoMidnight)).toBe(false);
  });

  it("covers a payment stamped at Cairo midnight outside DST", () => {
    const cairoMidnight = startOfDateCairo("2026-01-15");
    expect(cairoMidnight.toISOString().slice(0, 10)).toBe("2026-01-14");
    expect(covers(range("2026-01-15"), cairoMidnight)).toBe(true);
    expect(covers(range("2026-01-14"), cairoMidnight)).toBe(false);
  });

  it("keeps a late-evening Cairo payment on its own day", () => {
    // 23:30 Cairo on Aug 21 is 20:30Z the same UTC day, which the old
    // UTC-bucketed window already got right; guard against regressing it.
    const lateEvening = new Date("2026-08-21T20:30:00.000Z");
    expect(covers(range("2026-08-21"), lateEvening)).toBe(true);
    expect(covers(range("2026-08-22"), lateEvening)).toBe(false);
  });

  it("excludes the following Cairo midnight from the window", () => {
    const nextDayStart = startOfDateCairo("2026-08-22");
    expect(covers(range("2026-08-21"), nextDayStart)).toBe(false);
    expect(covers(range("2026-08-22"), nextDayStart)).toBe(true);
  });

  it("resolves the Cairo day of a full ISO timestamp", () => {
    // 2026-08-21T22:00Z is already Aug 22 in Cairo.
    expect(range("2026-08-21T22:00:00.000Z")?.$gte.toISOString()).toBe(
      startOfDateCairo("2026-08-22").toISOString(),
    );
  });

  it("returns no window for a missing or unparseable date", () => {
    expect(range("not-a-date")).toBeUndefined();
    expect(range("")).toBeUndefined();
    expect(range(undefined)).toBeUndefined();
  });
});

describe("buildCairoDateRangeQuery month windows", () => {
  it("spans the Cairo calendar month", () => {
    const window = range(undefined, 8, 2026);
    expect(window?.$gte.toISOString()).toBe(
      startOfDateCairo("2026-08-01").toISOString(),
    );
    expect(window?.$lt.toISOString()).toBe(
      startOfDateCairo("2026-09-01").toISOString(),
    );
  });

  it("includes a payment stamped at Cairo midnight on the first of the month", () => {
    const firstOfMonth = startOfDateCairo("2026-08-01");
    expect(covers(range(undefined, 8, 2026), firstOfMonth)).toBe(true);
    // The old UTC window started at 2026-08-01T00:00Z and dropped it into July.
    expect(covers(range(undefined, 7, 2026), firstOfMonth)).toBe(false);
  });

  it("includes a payment stamped at Cairo midnight on the last day", () => {
    const lastDay = startOfDateCairo("2026-08-31");
    expect(covers(range(undefined, 8, 2026), lastDay)).toBe(true);
    expect(covers(range(undefined, 9, 2026), lastDay)).toBe(false);
  });

  it("rolls December over to the next January", () => {
    const { start, end } = cairoMonthRange(2026, 12);
    expect(start.toISOString()).toBe(
      startOfDateCairo("2026-12-01").toISOString(),
    );
    expect(end.toISOString()).toBe(startOfDateCairo("2027-01-01").toISOString());
  });

  it("prefers an explicit date over a month", () => {
    expect(range("2026-08-21", 3, 2026)?.$gte.toISOString()).toBe(
      startOfDateCairo("2026-08-21").toISOString(),
    );
  });
});
