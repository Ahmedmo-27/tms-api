import { formatInTimeZone } from "date-fns-tz";
import { BadRequestError } from "../core/ApiError";
import { CAIRO_TZ, cairoDayRange, startOfDateCairo } from "./timezone";

export type Granularity = "day" | "month";

export interface FinanceRange {
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  locationId: string | null;
  granularity: Granularity;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 3 * 366;
/** Ranges up to ~2 months are bucketed per day, longer ones per month. */
const DAILY_BUCKET_MAX_DAYS = 62;

export function cairoKey(date: Date, granularity: Granularity = "day"): string {
  return formatInTimeZone(date, CAIRO_TZ, granularity === "day" ? "yyyy-MM-dd" : "yyyy-MM");
}

/**
 * Builds a half-open [start, end) Cairo calendar range from yyyy-MM-dd keys.
 * Defaults to the current Cairo month up to today.
 */
export function buildFinanceRange(
  query: { startDate?: unknown; endDate?: unknown },
  locationId: string | null,
): FinanceRange {
  const todayKey = cairoKey(new Date());
  const rawStart = typeof query.startDate === "string" ? query.startDate.trim() : "";
  const rawEnd = typeof query.endDate === "string" ? query.endDate.trim() : "";

  if ((rawStart && !DATE_KEY.test(rawStart)) || (rawEnd && !DATE_KEY.test(rawEnd))) {
    throw new BadRequestError("INVALID_DATE", "Dates must use the yyyy-MM-dd format");
  }

  let startKey = rawStart || (rawEnd ? rawEnd.slice(0, 8) + "01" : todayKey.slice(0, 8) + "01");
  let endKey = rawEnd || (rawStart && rawStart > todayKey ? rawStart : todayKey);
  if (startKey > endKey) [startKey, endKey] = [endKey, startKey];

  const start = startOfDateCairo(startKey);
  const end = cairoDayRange(endKey).end;
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestError("RANGE_TOO_LARGE", "Date range cannot exceed 3 years");
  }

  return {
    start,
    end,
    startKey,
    endKey,
    locationId,
    granularity: days <= DAILY_BUCKET_MAX_DAYS ? "day" : "month",
  };
}

/** The range of equal length immediately before `range`. */
export function previousRange(range: FinanceRange): FinanceRange {
  const length = range.end.getTime() - range.start.getTime();
  const start = new Date(range.start.getTime() - length);
  const end = range.start;
  return {
    ...range,
    start,
    end,
    startKey: cairoKey(start),
    endKey: cairoKey(new Date(end.getTime() - 1)),
  };
}

/** Every bucket key in the range, in order (calendar arithmetic on the keys, DST-safe). */
export function rangeBuckets(range: FinanceRange): string[] {
  const keys: string[] = [];
  const [sy, sm, sd] = range.startKey.split("-").map(Number);
  const [ey, em, ed] = range.endKey.split("-").map(Number);

  if (range.granularity === "month") {
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return keys;
  }

  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const last = Date.UTC(ey, em - 1, ed);
  while (cursor.getTime() <= last) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

/** Packages with this many sessions or more are effectively unlimited (the schema default is 10000). */
export const UNLIMITED_SESSIONS_THRESHOLD = 1000;

export function perSessionValue(pkg?: { price?: number; numberOfSessions?: number } | null): number | null {
  if (!pkg || !pkg.price || !pkg.numberOfSessions) return null;
  if (pkg.numberOfSessions >= UNLIMITED_SESSIONS_THRESHOLD) return null;
  return pkg.price / pkg.numberOfSessions;
}

export const DROP_IN_METHOD = "Drop In";

export type SalesSegment =
  | "FUNCTIONAL_TRAINING"
  | "STUDIO"
  | "PERSONAL_TRAINING"
  | "ONLINE_PERSONAL_TRAINING"
  | "PRE_POST_NATAL"
  | "MIXED"
  | "SPACE_MEMBERSHIP"
  | "ULTIMATE_MINDSPACER"
  | "OPEN_GYM"
  | "UNCATEGORIZED_PACKAGE"
  | "DROPIN"
  | "NON_MEMBER_DROPIN"
  | "WALKIN"
  | "OTHER";

export const SALES_SEGMENTS: SalesSegment[] = [
  "FUNCTIONAL_TRAINING",
  "STUDIO",
  "PERSONAL_TRAINING",
  "ONLINE_PERSONAL_TRAINING",
  "PRE_POST_NATAL",
  "MIXED",
  "SPACE_MEMBERSHIP",
  "ULTIMATE_MINDSPACER",
  "OPEN_GYM",
  "UNCATEGORIZED_PACKAGE",
  "DROPIN",
  "NON_MEMBER_DROPIN",
  "WALKIN",
  "OTHER",
];

/**
 * Packages carry no online/offline flag, so online PT is recognised the same
 * way the daily sheet does it: by "online" in the package name
 * (e.g. "1 month online PT with Salma").
 */
export function isOnlinePackageName(packageName?: string | null): boolean {
  return String(packageName ?? "").toLowerCase().includes("online");
}

export function paymentSegment(
  purpose: string,
  packageCategory?: string | null,
  packageName?: string | null,
): SalesSegment {
  switch (purpose) {
    case "PACKAGE":
    case "NON_USER_PACKAGE":
      if (packageCategory === "PERSONAL_TRAINING") {
        return isOnlinePackageName(packageName)
          ? "ONLINE_PERSONAL_TRAINING"
          : "PERSONAL_TRAINING";
      }
      return (packageCategory &&
      (SALES_SEGMENTS as string[]).includes(packageCategory)
        ? packageCategory
        : "UNCATEGORIZED_PACKAGE") as SalesSegment;
    case "DROPIN":
      return "DROPIN";
    case "NON_USER_BOOKING":
      return "NON_MEMBER_DROPIN";
    case "WALKIN":
      return "WALKIN";
    default:
      return "OTHER";
  }
}

/** Payment methods that are not new money (the cost was taken from a newly bought package). */
export const NON_REVENUE_METHODS = ["DEDUCTED"];
export const ONLINE_METHODS = ["APP", "PAYMENT_LINK"];
