import { toZonedTime, fromZonedTime } from "date-fns-tz";

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

export function startOfDateCairo(date: Date | string): Date {
  const cairoDate = toZonedTime(new Date(date), CAIRO_TZ);
  cairoDate.setHours(0, 0, 0, 0);
  return fromZonedTime(cairoDate, CAIRO_TZ);
}

export function endOfDateCairo(date: Date | string): Date {
  const cairoDate = toZonedTime(new Date(date), CAIRO_TZ);
  cairoDate.setHours(23, 59, 59, 999);
  return fromZonedTime(cairoDate, CAIRO_TZ);
}

/** Half-open [start, end) Cairo calendar-day bounds for package start-day matching. */
export function cairoDayRange(date: Date | string): { start: Date; end: Date } {
  const start = startOfDateCairo(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function nowInCairo(): Date {
  return toZonedTime(new Date(), CAIRO_TZ);
}
