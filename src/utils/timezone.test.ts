import { formatInTimeZone } from "date-fns-tz";
import {
  CAIRO_TZ,
  cairoDateKey,
  isSameCairoDay,
  startOfDateCairo,
} from "./timezone";

describe("startOfDateCairo", () => {
  it("keeps a yyyy-MM-dd calendar day as that Cairo day (no UTC midnight shift)", () => {
    // Regression: new Date("2025-06-02").toISOString() is June 2 UTC midnight,
    // but naive local-midnight → toISOString flows store the previous UTC day.
    const start = startOfDateCairo("2025-06-02");
    expect(formatInTimeZone(start, CAIRO_TZ, "yyyy-MM-dd")).toBe("2025-06-02");
    expect(cairoDateKey(start)).toBe("2025-06-02");
  });

  it("normalizes Cairo local midnight Date#toString() to the picked calendar day", () => {
    // What PopoverDatePicker used to send for a June 2 pick in Egypt.
    const pickerValue = "Mon Jun 02 2025 00:00:00 GMT+0300";
    const start = startOfDateCairo(pickerValue);
    expect(cairoDateKey(start)).toBe("2025-06-02");
    // Stored ISO is the previous UTC evening, which is still June 2 in Cairo.
    expect(start.toISOString()).toBe("2025-06-01T21:00:00.000Z");
  });

  it("is stable when re-normalizing an already-stored Cairo start instant", () => {
    const stored = "2025-06-01T21:00:00.000Z";
    expect(cairoDateKey(startOfDateCairo(stored))).toBe("2025-06-02");
  });
});

describe("isSameCairoDay", () => {
  it("treats Cairo midnight ISO and the matching yyyy-MM-dd as the same day", () => {
    expect(isSameCairoDay("2025-06-01T21:00:00.000Z", "2025-06-02")).toBe(
      true,
    );
    expect(isSameCairoDay("2025-06-01T21:00:00.000Z", "2025-06-01")).toBe(
      false,
    );
  });
});
