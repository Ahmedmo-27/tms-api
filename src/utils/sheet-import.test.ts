import {
  parseSheetClassHeader,
  pickBestCatalogClass,
  matchCatalogClassForHeader,
  scoreCatalogClassTitle,
  formatSheetClassHeader,
  normalizeSheetHeader,
} from "./sheet-import";

describe("parseSheetClassHeader", () => {
  it("parses Strength 7:30 Am", () => {
    expect(parseSheetClassHeader("Strength 7:30 Am")).toEqual({
      name: "Strength",
      hours: 7,
      minutes: 30,
    });
  });

  it("parses Mat Pilates 9 am", () => {
    expect(parseSheetClassHeader("Mat Pilates 9 am")).toEqual({
      name: "Mat Pilates",
      hours: 9,
      minutes: 0,
    });
  });

  it("parses times without Am/Pm using the studio heuristic", () => {
    expect(parseSheetClassHeader("Conditioning 7:30")).toEqual({
      name: "Conditioning",
      hours: 7,
      minutes: 30,
    });
    expect(parseSheetClassHeader("Ladies Workout 11")).toEqual({
      name: "Ladies Workout",
      hours: 11,
      minutes: 0,
    });
    expect(parseSheetClassHeader("Reformer 5:30")).toEqual({
      name: "Reformer",
      hours: 17,
      minutes: 30,
    });
  });

  it("parses compact Am/Pm times", () => {
    expect(parseSheetClassHeader("Strength 11AM")).toEqual({
      name: "Strength",
      hours: 11,
      minutes: 0,
    });
    expect(parseSheetClassHeader("Mobilize 7PM")).toEqual({
      name: "Mobilize",
      hours: 19,
      minutes: 0,
    });
  });

  it("handles 12 pm and 12 am", () => {
    expect(parseSheetClassHeader("Yoga 12 pm")?.hours).toBe(12);
    expect(parseSheetClassHeader("Yoga 12 am")?.hours).toBe(0);
  });
});

describe("catalog class matching", () => {
  const catalog = [
    { title: "Strength" },
    { title: "Mat Pilates" },
    { title: "Reformer Pilates" },
  ];

  it("picks an exact title", () => {
    expect(pickBestCatalogClass("Strength", catalog)?.title).toBe("Strength");
    expect(pickBestCatalogClass("Mat Pilates", catalog)?.title).toBe(
      "Mat Pilates",
    );
  });

  it("does not confuse Mat with Reformer", () => {
    expect(scoreCatalogClassTitle("Mat Pilates", "Reformer Pilates")).toBeLessThan(
      70,
    );
  });

  it("returns null when nothing matches", () => {
    expect(pickBestCatalogClass("Clinic", catalog)).toBeNull();
  });
});

describe("abbreviated class headers", () => {
  const catalog = [
    { title: "Mat Pilates", category: "STUDIO" },
    { title: "Reformer Pilates", category: "STUDIO" },
    { title: "Rope Flow", category: "STUDIO" },
    { title: "Conditioning (Intervals)", category: "FUNCTIONAL_TRAINING" },
    { title: "Strength (Full Body)", category: "FUNCTIONAL_TRAINING" },
    { title: "Ladies Workout", category: "FUNCTIONAL_TRAINING" },
  ];

  const matchTitle = (header: string) => {
    const result = matchCatalogClassForHeader(header, catalog);
    return result.ok ? result.item.title : null;
  };

  it("scores FT against a class actually titled Functional Training", () => {
    expect(scoreCatalogClassTitle("FT", "Functional Training")).toBe(100);
    expect(
      scoreCatalogClassTitle("FT 11AM", "Functional Training 11:00 Am"),
    ).toBe(100);
  });

  it("resolves shorthand titles", () => {
    expect(matchTitle(parseSheetClassHeader("Cond 7:30")!.name)).toBe(
      "Conditioning (Intervals)",
    );
    expect(matchTitle(parseSheetClassHeader("Ref 5:30")!.name)).toBe(
      "Reformer Pilates",
    );
    expect(matchTitle(parseSheetClassHeader("RF 8")!.name)).toBe("Rope Flow");
    expect(matchTitle(parseSheetClassHeader("LW 11")!.name)).toBe(
      "Ladies Workout",
    );
  });

  it("refuses to guess between classes of the same category", () => {
    const result = matchCatalogClassForHeader("FT", catalog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected no match");
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") throw new Error("expected ambiguity");
    expect(result.titles).toEqual([
      "Conditioning (Intervals)",
      "Strength (Full Body)",
      "Ladies Workout",
    ]);
  });

  it("uses a category abbreviation when only one class has it", () => {
    const result = matchCatalogClassForHeader("ST", [
      { title: "Mat Pilates", category: "STUDIO" },
      { title: "Strength (Full Body)", category: "FUNCTIONAL_TRAINING" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a match");
    expect(result.item.title).toBe("Mat Pilates");
  });

  it("says which category is missing from the branch catalog", () => {
    const result = matchCatalogClassForHeader("FT", [
      { title: "Mat Pilates", category: "STUDIO" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected no match");
    expect(result.reason).toBe("category_missing");
    if (result.reason !== "category_missing") throw new Error("wrong reason");
    expect(result.category).toBe("FUNCTIONAL_TRAINING");
  });

  it("reports no match for an unknown header", () => {
    const result = matchCatalogClassForHeader("Clinic", catalog);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected no match");
    expect(result.reason).toBe("none");
  });
});

describe("formatSheetClassHeader", () => {
  it("uses the same Am/Pm casing as the sheet GET", () => {
    const start = new Date("2026-07-30T05:30:00.000Z");
    const header = formatSheetClassHeader("Strength", start);
    expect(normalizeSheetHeader(header)).toContain("strength");
    expect(header).toMatch(/Am|Pm/);
  });
});
