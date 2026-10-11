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

/** Half-open [start, end) Cairo calendar-month bounds. `month` is 1-12. */
export function cairoMonthRange(
  year: number,
  month: number,
): { start: Date; end: Date } {
  const pad = (value: number) => String(value).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: startOfDateCairo(`${year}-${pad(month)}-01`),
    end: startOfDateCairo(`${nextYear}-${pad(nextMonth)}-01`),
  };
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

/**
 * Package validity is inclusive of its end day on the Cairo calendar: a package
 * ending 28/10 stays usable for the whole of 28/10.
 *
 * Stored package dates are UTC noon of their Cairo day (see
 * toStoredPackageDate), so comparing `pkgEndDate` directly against `now` cut
 * the final day off at ~14:00 Cairo — members lost the evening of their last
 * day. Compare Cairo calendar days instead.
 */
export function isPackageExpired(
  pkgEndDate: Date | string,
  now: Date | string = new Date(),
): boolean {
  return cairoDateKey(pkgEndDate) < cairoDateKey(now);
}

/** True when the package's Cairo start day has not arrived yet. */
export function isPackageNotStarted(
  pkgStartDate: Date | string,
  now: Date | string = new Date(),
): boolean {
  return cairoDateKey(pkgStartDate) > cairoDateKey(now);
}

/**
 * Lower bound for "the package's end day is today or later", for Mongo
 * queries and array filters. Pairs with isPackageExpired: any pkgEndDate on
 * today's Cairo day or later is >= this instant.
 */
export function activeEndDateBound(now: Date | string = new Date()): Date {
  return startOfDateCairo(now);
}

/** Whole Cairo calendar days from `now` until `date` (0 = ends today). */
export function cairoDaysUntil(
  date: Date | string,
  now: Date | string = new Date(),
): number {
  const dayStartUtc = (value: Date | string) => {
    const [y, m, d] = cairoDateKey(value).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((dayStartUtc(date) - dayStartUtc(now)) / 86400000);
}
