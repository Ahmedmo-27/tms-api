import { formatInTimeZone } from "date-fns-tz";
import {
  CAIRO_TZ,
  cairoDateKey,
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
