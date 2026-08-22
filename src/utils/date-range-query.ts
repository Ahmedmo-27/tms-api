import { cairoDateKey, cairoDayRange, cairoMonthRange } from "./timezone";

/**
 * Mongo range filter for a single Africa/Cairo calendar day or month.
 *
 * Day and month bounds must be Cairo, not server-local. Records written for a
 * calendar day are stamped at Cairo midnight, which is 21:00/22:00Z on the
 * *previous* UTC day, so a UTC-bucketed window files a whole day of them under
 * the day before.
 *
 * `dateString` takes precedence over `month`/`year`. It accepts a yyyy-MM-dd
 * key or any parseable timestamp, whose Cairo calendar day is used. An
 * unparseable value yields an empty filter (no date constraint).
 */
export function buildCairoDateRangeQuery(
  dateField: string,
  dateString?: string,
  month?: number,
  year?: number,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (dateString && dateString !== "") {
    if (!Number.isNaN(new Date(dateString).getTime())) {
      const { start, end } = cairoDayRange(dateString);
      query[dateField] = { $gte: start, $lt: end };
    }
    return query;
  }

  if (month) {
    const targetYear = year || Number(cairoDateKey(new Date()).slice(0, 4));
    const { start, end } = cairoMonthRange(targetYear, month);
    query[dateField] = { $gte: start, $lt: end };
  }

  return query;
}
