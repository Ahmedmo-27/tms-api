import { cairoDateKey, cairoDayRange, cairoMonthRange, startOfDateCairo } from "./timezone";

/**
 * Mongo range filter for an Africa/Cairo calendar date range, single day, or month.
 *
 * Day and month bounds must be Cairo, not server-local. Records written for a
 * calendar day are stamped at Cairo midnight, which is 21:00/22:00Z on the
 * *previous* UTC day, so a UTC-bucketed window files a whole day of them under
 * the day before.
 *
 * `startDate` and `endDate` or `dateString` take precedence over `month`/`year`.
 * They accept yyyy-MM-dd keys or parseable timestamps.
 */
export function buildCairoDateRangeQuery(
  dateField: string,
  dateString?: string,
  month?: number,
  year?: number,
  startDate?: string,
  endDate?: string,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  const effectiveStart = startDate || (dateString && dateString !== "" ? dateString : undefined);
  const effectiveEnd = endDate || (startDate ? startDate : effectiveStart);

  if (effectiveStart && effectiveEnd) {
    if (
      !Number.isNaN(new Date(effectiveStart).getTime()) &&
      !Number.isNaN(new Date(effectiveEnd).getTime())
    ) {
      let start = startOfDateCairo(effectiveStart);
      let end = cairoDayRange(effectiveEnd).end;

      if (start > end) {
        // Swap bounds if start is after end
        start = startOfDateCairo(effectiveEnd);
        end = cairoDayRange(effectiveStart).end;
      }

      query[dateField] = { $gte: start, $lt: end };
      return query;
    }
  }

  if (month) {
    const targetYear = year || Number(cairoDateKey(new Date()).slice(0, 4));
    const { start, end } = cairoMonthRange(targetYear, month);
    query[dateField] = { $gte: start, $lt: end };
  }

  return query;
}

