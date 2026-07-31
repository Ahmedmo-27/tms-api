import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const CAIRO_TZ = "Africa/Cairo";

export function startOfTodayCairo(): Date {
  const cairoNow = toZonedTime(new Date(), CAIRO_TZ);
  cairoNow.setHours(0, 0, 0, 0);
  return fromZonedTime(cairoNow, CAIRO_TZ);
}

export function endOfTodayCairo(): Date {
  const cairoNow = toZonedTime(new Date(), CAIRO_TZ);
  cairoNow.setHours(23, 59, 59, 999);
  return fromZonedTime(cairoNow, CAIRO_TZ);
}

/**
 * Calendar-day start in Africa/Cairo.
 * Accepts date-only strings (yyyy-MM-dd), Date instances, or ISO/local date strings.
 * Date-only values are interpreted as that Cairo calendar day (not UTC midnight).
 */
export function startOfDateCairo(date: Date | string): Date {
  if (typeof date === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (dateOnly) {
      const [, y, m, d] = dateOnly;
      // Construct noon UTC then snap to Cairo start-of-day to avoid UTC-midnight
      // shifting the calendar day for positive-offset zones.
      const approx = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12));
      const cairoDate = toZonedTime(approx, CAIRO_TZ);
      cairoDate.setHours(0, 0, 0, 0);
      return fromZonedTime(cairoDate, CAIRO_TZ);
    }
  }
  const cairoDate = toZonedTime(new Date(date), CAIRO_TZ);
  cairoDate.setHours(0, 0, 0, 0);
  return fromZonedTime(cairoDate, CAIRO_TZ);
}

export function endOfDateCairo(date: Date | string): Date {
  const cairoDate = toZonedTime(startOfDateCairo(date), CAIRO_TZ);
  cairoDate.setHours(23, 59, 59, 999);
  return fromZonedTime(cairoDate, CAIRO_TZ);
}

/** Half-open [start, end) Cairo calendar-day bounds for package start-day matching. */
export function cairoDayRange(date: Date | string): { start: Date; end: Date } {
  const start = startOfDateCairo(date);
  const cairoStart = toZonedTime(start, CAIRO_TZ);
  cairoStart.setDate(cairoStart.getDate() + 1);
  const end = fromZonedTime(cairoStart, CAIRO_TZ);
  return { start, end };
}

/** yyyy-MM-dd key for the Cairo calendar day of an instant. */
export function cairoDateKey(date: Date | string): string {
  if (typeof date === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (dateOnly) return dateOnly[0];
  }
  return formatInTimeZone(new Date(date), CAIRO_TZ, "yyyy-MM-dd");
}

/**
 * Persist a calendar day as UTC noon of that Africa/Cairo day.
 * Avoids the classic off-by-one where Cairo local midnight (e.g. June 2 00:00
 * = June 1 21:00Z) is shown as the previous day by UTC-naive formatters.
 */
export function toStoredPackageDate(date: Date | string): Date {
  const [y, m, d] = cairoDateKey(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

/** True when both values fall on the same Africa/Cairo calendar day. */
export function isSameCairoDay(a: Date | string, b: Date | string): boolean {
  return cairoDateKey(a) === cairoDateKey(b);
}

export function nowInCairo(): Date {
  return toZonedTime(new Date(), CAIRO_TZ);
}
