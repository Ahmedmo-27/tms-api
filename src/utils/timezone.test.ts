import { formatInTimeZone } from "date-fns-tz";
import {
  CAIRO_TZ,
  activeEndDateBound,
  cairoDateKey,
  cairoDaysUntil,
  isPackageExpired,
  isPackageNotStarted,
  isSameCairoDay,
  startOfDateCairo,
  toStoredPackageDate,
} from "./timezone";

describe("startOfDateCairo", () => {
  it("keeps a yyyy-MM-dd calendar day as that Cairo day (no UTC midnight shift)", () => {
    const start = startOfDateCairo("2025-06-02");
    expect(formatInTimeZone(start, CAIRO_TZ, "yyyy-MM-dd")).toBe("2025-06-02");
    expect(cairoDateKey(start)).toBe("2025-06-02");
  });

  it("normalizes Cairo local midnight Date#toString() to the picked calendar day", () => {
    // What PopoverDatePicker used to send for a June 2 pick in Egypt.
    const pickerValue = "Mon Jun 02 2025 00:00:00 GMT+0300";
    const start = startOfDateCairo(pickerValue);
    expect(cairoDateKey(start)).toBe("2025-06-02");
  });

  it("is stable when re-normalizing an already-stored Cairo start instant", () => {
    const stored = "2025-06-01T21:00:00.000Z";
    expect(cairoDateKey(startOfDateCairo(stored))).toBe("2025-06-02");
  });
});

describe("toStoredPackageDate", () => {
  it("stores June 2 as UTC noon so naive formatters do not show June 1", () => {
    const stored = toStoredPackageDate("2025-06-02");
    expect(stored.toISOString()).toBe("2025-06-02T12:00:00.000Z");
    expect(stored.toISOString().slice(0, 10)).toBe("2025-06-02");
    expect(cairoDateKey(stored)).toBe("2025-06-02");
  });

  it("maps a Cairo local-midnight picker string to the same calendar day", () => {
    const stored = toStoredPackageDate("Mon Jun 02 2025 00:00:00 GMT+0300");
    expect(stored.toISOString()).toBe("2025-06-02T12:00:00.000Z");
  });
});

describe("isSameCairoDay", () => {
  it("treats Cairo midnight ISO, UTC noon storage, and yyyy-MM-dd as the same day", () => {
    expect(isSameCairoDay("2025-06-01T21:00:00.000Z", "2025-06-02")).toBe(
      true,
    );
    expect(isSameCairoDay("2025-06-02T12:00:00.000Z", "2025-06-02")).toBe(
      true,
    );
    expect(isSameCairoDay("2025-06-01T21:00:00.000Z", "2025-06-01")).toBe(
      false,
    );
  });
});

describe("day-inclusive package validity", () => {
  // A package ending 28/01 is stored as 2025-01-28T12:00:00Z (UTC noon of the
  // Cairo day). Comparing that instant against `now` used to expire it at
  // ~14:00 Cairo, so the member lost the evening of their last day.
  // Cairo is UTC+02:00 in January (no DST) and UTC+03:00 in summer.
  const endDate = toStoredPackageDate("2025-01-28");

  it("stays unexpired all through its end day in Cairo", () => {
    const cairoInstants = [
      "2025-01-28T00:00:00+02:00",
      "2025-01-28T13:00:00+02:00",
      "2025-01-28T16:00:00+02:00",
      "2025-01-28T20:30:00+02:00",
      "2025-01-28T23:59:00+02:00",
    ];
    for (const instant of cairoInstants) {
      expect(cairoDateKey(instant)).toBe("2025-01-28");
      expect(isPackageExpired(endDate, new Date(instant))).toBe(false);
    }
  });

  it("expires once the Cairo day rolls over", () => {
    expect(isPackageExpired(endDate, new Date("2025-01-29T00:01:00+02:00"))).toBe(
      true,
    );
    expect(isPackageExpired(endDate, new Date("2025-01-29T08:00:00+02:00"))).toBe(
      true,
    );
  });

  it("holds the whole end day during Cairo summer time too", () => {
    const summerEnd = toStoredPackageDate("2025-07-28");
    expect(
      isPackageExpired(summerEnd, new Date("2025-07-28T22:00:00+03:00")),
    ).toBe(false);
    expect(
      isPackageExpired(summerEnd, new Date("2025-07-29T00:30:00+03:00")),
    ).toBe(true);
  });

  it("is usable from the first minute of its start day", () => {
    const startDate = toStoredPackageDate("2025-01-28");
    expect(
      isPackageNotStarted(startDate, new Date("2025-01-28T00:05:00+02:00")),
    ).toBe(false);
    expect(
      isPackageNotStarted(startDate, new Date("2025-01-27T23:00:00+02:00")),
    ).toBe(true);
  });

  it("keeps the end day inside the Mongo active bound", () => {
    const boundOnEndDay = activeEndDateBound(
      new Date("2025-01-28T21:00:00+02:00"),
    );
    expect(endDate >= boundOnEndDay).toBe(true);

    const boundNextDay = activeEndDateBound(
      new Date("2025-01-29T01:00:00+02:00"),
    );
    expect(endDate >= boundNextDay).toBe(false);
  });

  it("counts whole Cairo days until expiry, 0 on the last day", () => {
    expect(cairoDaysUntil(endDate, new Date("2025-01-28T20:00:00+02:00"))).toBe(0);
    expect(cairoDaysUntil(endDate, new Date("2025-01-27T01:00:00+02:00"))).toBe(1);
    expect(cairoDaysUntil(endDate, new Date("2025-01-29T01:00:00+02:00"))).toBe(-1);
  });
});
