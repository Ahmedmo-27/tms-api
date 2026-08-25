import { formatInTimeZone } from "date-fns-tz";
import { CAIRO_TZ } from "./timezone";
import { expandSheetTokens, sheetAbbreviationCategory } from "./sheet-labels";

export type ParsedSheetClassHeader = {
  name: string;
  hours: number;
  minutes: number;
};

function tokens(raw: string): string[] {
  // Drop clock parts, including compact ones like "11am" that survive splitting.
  return expandSheetTokens(raw, "replace").filter(
    (t) => t !== "am" && t !== "pm" && !/^\d+(am|pm)?$/.test(t),
  );
}

export function parseSheetClassHeader(
  title: string,
): ParsedSheetClassHeader | null {
  const s = (title || "").trim();
  if (!s) return null;

  const withMinutes = s.match(
    /^(.*?)\s+(\d{1,2})[:.](\d{2})\s*(am|pm)\s*$/i,
  );
  if (withMinutes) {
    return {
      name: withMinutes[1].trim(),
      hours: toHours(Number(withMinutes[2]), withMinutes[4]),
      minutes: Number(withMinutes[3]),
    };
  }

  const hourOnly = s.match(/^(.*?)\s+(\d{1,2})\s*(am|pm)\s*$/i);
  if (hourOnly) {
    return {
      name: hourOnly[1].trim(),
      hours: toHours(Number(hourOnly[2]), hourOnly[3]),
      minutes: 0,
    };
  }

  const minutesNoMeridiem = s.match(/^(.*?)\s+(\d{1,2})[:.](\d{2})\s*$/i);
  if (minutesNoMeridiem && minutesNoMeridiem[1].trim()) {
    const hour = Number(minutesNoMeridiem[2]);
    if (hour >= 1 && hour <= 12) {
      return {
        name: minutesNoMeridiem[1].trim(),
        hours: studioHeuristicHours(hour),
        minutes: Number(minutesNoMeridiem[3]),
      };
    }
  }

  const hourNoMeridiem = s.match(/^(.*?)\s+(\d{1,2})\s*$/i);
  if (hourNoMeridiem && hourNoMeridiem[1].trim()) {
    const hour = Number(hourNoMeridiem[2]);
    if (hour >= 1 && hour <= 12) {
      return {
        name: hourNoMeridiem[1].trim(),
        hours: studioHeuristicHours(hour),
        minutes: 0,
      };
    }
  }

  return null;
}

function toHours(hour: number, meridiem: string): number {
  const mer = meridiem.toLowerCase();
  if (mer === "pm" && hour < 12) return hour + 12;
  if (mer === "am" && hour === 12) return 0;
  return hour;
}

/** Studio sheet times without Am/Pm: 1–6 → PM, 7–11 → AM, 12 → PM. */
function studioHeuristicHours(hour: number): number {
  if (hour >= 1 && hour <= 6) return hour + 12;
  if (hour === 12) return 12;
  return hour;
}

export function formatSheetClassHeader(title: string, startTime: Date): string {
  const time = formatInTimeZone(startTime, CAIRO_TZ, "h:mm a").replace(
    /\s(AM|PM)$/i,
    (_: string, mer: string) =>
      ` ${mer[0].toUpperCase()}${mer.slice(1).toLowerCase()}`,
  );
  return `${title} ${time}`.trim();
}

export function normalizeSheetHeader(value: string): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreCatalogClassTitle(
  headerName: string,
  catalogTitle: string,
): number {
  const headerTokens = tokens(headerName);
  const catalogTokens = tokens(catalogTitle);
  if (!headerTokens.length || !catalogTokens.length) return 0;
  if (headerTokens.join(" ") === catalogTokens.join(" ")) return 100;

  const catalogSet = new Set(catalogTokens);
  const overlap = headerTokens.filter((t) => catalogSet.has(t)).length;
  if (overlap === headerTokens.length) {
    return 80 + Math.min(19, catalogTokens.length);
  }
  if (overlap === 0) return 0;
  return Math.round(
    (overlap / Math.max(headerTokens.length, catalogTokens.length)) * 60,
  );
}

export function rankCatalogClasses<T extends { title: string }>(
  headerName: string,
  catalog: T[],
): Array<{ item: T; score: number }> {
  if (!headerName.trim() || catalog.length === 0) return [];
  return catalog
    .map((item) => ({ item, score: scoreCatalogClassTitle(headerName, item.title) }))
    .filter((entry) => entry.score >= 70)
    .sort((a, b) => b.score - a.score);
}

export function pickBestCatalogClass<T extends { title: string }>(
  headerName: string,
  catalog: T[],
): T | null {
  const scored = rankCatalogClasses(headerName, catalog);
  if (scored.length === 0) return null;
  if (scored.length === 1 || scored[0].score > scored[1].score) {
    return scored[0].item;
  }
  return null;
}

export type CatalogClassMatch<T> =
  | { ok: true; item: T }
  | { ok: false; reason: "ambiguous"; titles: string[] }
  | { ok: false; reason: "category_missing"; category: string }
  | { ok: false; reason: "none" };

/**
 * Headers are often shorthand ("Cond 7:30", "FT 11"). Fall back to the class
 * category when the shorthand names no title, and never guess between siblings
 * such as the Strength variants.
 */
export function matchCatalogClassForHeader<
  T extends { title: string; category?: string },
>(headerName: string, catalog: T[]): CatalogClassMatch<T> {
  const ranked = rankCatalogClasses(headerName, catalog);
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)) {
    return { ok: true, item: ranked[0].item };
  }
  if (ranked.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      titles: ranked
        .filter((entry) => entry.score === ranked[0].score)
        .map((entry) => entry.item.title),
    };
  }

  const category = sheetAbbreviationCategory(headerName);
  if (category) {
    const inCategory = catalog.filter(
      (item) => (item.category || "").toUpperCase() === category,
    );
    if (inCategory.length === 1) return { ok: true, item: inCategory[0] };
    if (inCategory.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        titles: inCategory.map((item) => item.title),
      };
    }
    return { ok: false, reason: "category_missing", category };
  }

  return { ok: false, reason: "none" };
}
