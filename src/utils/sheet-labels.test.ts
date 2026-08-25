import {
  classifySheetRow,
  expandSheetTokens,
  mapClassMethodToSheetLabel,
  mapPaymentMethod,
  mapPtMethodToSheetLabel,
  matchPackageByPurpose,
  sheetAbbreviationCategory,
} from "./sheet-labels";

describe("mapClassMethodToSheetLabel", () => {
  it("maps functional training packages to Ft App member", () => {
    expect(mapClassMethodToSheetLabel("10 Functional Training")).toEqual({
      kind: "label",
      label: "Ft App member",
    });
  });

  it("marks drop-ins", () => {
    expect(mapClassMethodToSheetLabel("Drop In")).toEqual({ kind: "dropin" });
  });
});

describe("mapPtMethodToSheetLabel", () => {
  it("shortens personal training with a coach", () => {
    expect(mapPtMethodToSheetLabel("10 Personal Training with Salma")).toEqual({
      kind: "label",
      label: "PT with Salma",
    });
  });
});

describe("classifySheetRow", () => {
  it("requires a name", () => {
    expect(classifySheetRow({ pane: "class", name: "" }).kind).toBe("invalid");
  });

  it("classifies class membership without payment as attend", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Hana",
        memberLabel: "Ft App member",
      }),
    ).toEqual({ kind: "class_attend" });
  });

  it("classifies class drop-in payments", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Radwa",
        amount: 450,
        purpose: "Drop in",
        paymentMethod: "Cash",
      }),
    ).toEqual({ kind: "class_dropin" });
  });

  it("classifies Visa without an amount as a class drop-in, not package attendance", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Daniella",
        memberLabel: "ST App member",
        paymentMethod: "Visa",
      }),
    ).toEqual({ kind: "class_dropin" });
  });

  it("classifies Drop in purpose without an amount as a class drop-in", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Radwa",
        purpose: "Drop in",
        paymentMethod: "Visa",
      }),
    ).toEqual({ kind: "class_dropin" });
  });

  it("still classifies membership-only rows as attend", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Hana",
        memberLabel: "Class Credit",
      }),
    ).toEqual({ kind: "class_attend" });
  });

  it("classifies package purchases on a class as subscribe then attend", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Nadine",
        amount: 3500,
        purpose: "10 FT",
      }),
    ).toEqual({ kind: "class_package_then_attend" });
  });

  it("classifies FOC as guest attend", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Carine",
        memberLabel: "FOC",
      }),
    ).toEqual({ kind: "class_foc" });
  });

  it("classifies PT membership on the space pane", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Lily",
        memberLabel: "PT with Lujain",
      }),
    ).toEqual({ kind: "pt_attend" });
  });

  it("classifies space membership", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Nermeen",
        memberLabel: "Space membership",
      }),
    ).toEqual({ kind: "space_attend" });
  });

  it("skips clinic rows", () => {
    const result = classifySheetRow({
      pane: "space_pt",
      name: "Youssef",
      memberLabel: "clinic",
    });
    expect(result.kind).toBe("skip_unmapped");
  });

  it("classifies space drop-ins", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Malek",
        amount: 400,
        purpose: "Drop in Space",
      }),
    ).toEqual({ kind: "space_dropin" });
  });

  it("classifies cash outs", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Cash Out",
        amount: -500,
        purpose: "Office supplies",
        paymentMethod: "Cash",
      }),
    ).toEqual({ kind: "cash_out" });

    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Cash Out",
        amount: 300,
        purpose: "Water",
        paymentMethod: "Cash",
      }),
    ).toEqual({ kind: "cash_out" });
  });

  it("classifies member refunds", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Ahmed Ali",
        amount: -1500,
        purpose: "Refund: FT package",
        paymentMethod: "Cash",
      }),
    ).toEqual({ kind: "member_refund" });

    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Farida",
        purpose: "Refund",
        amount: 500,
      }),
    ).toEqual({ kind: "member_refund" });
  });

  it("skips will pay / will renew / will scan", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Hana",
        memberLabel: "will pay",
      }).kind,
    ).toBe("skip_unmapped");
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Hana",
        purpose: "will renew 1 month space",
      }).kind,
    ).toBe("skip_unmapped");
    expect(
      classifySheetRow({
        pane: "class",
        name: "Hana",
        memberLabel: "will scan",
      }).kind,
    ).toBe("skip_unmapped");
  });

  it("skips invitations on class and Space/PT", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Guest",
        memberLabel: "Inv From Ali",
      }),
    ).toMatchObject({
      kind: "skip_unmapped",
      reason: expect.stringMatching(/invitation/i),
    });
    expect(
      classifySheetRow({
        pane: "class",
        name: "Guest",
        memberLabel: "Invitation from aly nassef",
      }).kind,
    ).toBe("skip_unmapped");
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Guest",
        memberLabel: "haidy inv",
      }).kind,
    ).toBe("skip_unmapped");
  });

  it("skips FOC on Space/PT with a clear reason", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Guest",
        memberLabel: "FOC",
      }),
    ).toMatchObject({
      kind: "skip_unmapped",
      reason: expect.stringMatching(/FOC on Space\/PT/i),
    });
  });

  it("skips assessment, check package, and rehab", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Youssef",
        memberLabel: "Assessment",
      }).kind,
    ).toBe("skip_unmapped");
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Youssef",
        purpose: "Check package",
      }).kind,
    ).toBe("skip_unmapped");
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Youssef",
        memberLabel: "Rehab",
      }).kind,
    ).toBe("skip_unmapped");
  });

  it("marks retail with money as invalid", () => {
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Retail",
        amount: 350,
        purpose: "Weleda",
        paymentMethod: "Cash",
      }),
    ).toEqual({
      kind: "invalid",
      reason: "Product sale, not a check-in",
    });
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Retail",
        amount: 150,
        purpose: "Trace Brow Soap",
        paymentMethod: "Visa",
      }).kind,
    ).toBe("invalid");
    expect(
      classifySheetRow({
        pane: "space_pt",
        name: "Retail",
        amount: 80,
        purpose: "socks",
        paymentMethod: "Cash",
      }).kind,
    ).toBe("invalid");
  });

  it("rejects split payment amounts", () => {
    expect(
      classifySheetRow({
        pane: "class",
        name: "Nadine",
        amountText: "1925+325",
        purpose: "10 FT",
      }),
    ).toMatchObject({ kind: "invalid" });
  });

  it("keeps odd clinic typos as unmapped errors rather than clinic skip", () => {
    const result = classifySheetRow({
      pane: "space_pt",
      name: "Youssef",
      memberLabel: "dlinic",
    });
    expect(result.kind).toBe("skip_unmapped");
    expect(result).toMatchObject({
      reason: expect.not.stringMatching(/clinic/i),
    });
  });
});

describe("mapPaymentMethod", () => {
  it("accepts sheet casing", () => {
    expect(mapPaymentMethod("Visa").method).toBe("VISA");
    expect(mapPaymentMethod("Cash").method).toBe("CASH");
    expect(mapPaymentMethod("App").method).toBe("APP");
  });

  it("maps link payment to Payment Link", () => {
    expect(mapPaymentMethod("link payment").method).toBe("PAYMENT_LINK");
    expect(mapPaymentMethod("Payment Link").method).toBe("PAYMENT_LINK");
  });

  it("leaves typos and split methods as errors", () => {
    expect(mapPaymentMethod("Vsa").method).toBeNull();
    expect(mapPaymentMethod("Csah").method).toBeNull();
    expect(mapPaymentMethod("Visa+instapay").method).toBeNull();
    expect(mapPaymentMethod("Cash+App").method).toBeNull();
    expect(mapPaymentMethod("Ali").method).toBeNull();
  });
});

describe("matchPackageByPurpose", () => {
  const catalog = [
    {
      id: "ft10",
      name: "10 Functional Training",
      category: "FUNCTIONAL_TRAINING",
      numberOfSessions: 10,
    },
    {
      id: "ums1",
      name: "1 Month Ultimate Mindspacer",
      category: "ULTIMATE_MINDSPACER",
      numberOfSessions: 10000,
    },
    {
      id: "pt-y",
      name: "10 Personal Training with Youssef",
      category: "PERSONAL_TRAINING",
      numberOfSessions: 10,
      coachName: "Youssef",
    },
  ];

  it("matches 10 FT to functional training", () => {
    expect(matchPackageByPurpose("10 FT", catalog)?.id).toBe("ft10");
  });

  it("matches 1 month UMS", () => {
    expect(matchPackageByPurpose("1 month UMS", catalog)?.id).toBe("ums1");
  });

  it("matches PT with coach", () => {
    expect(matchPackageByPurpose("10 Pt with Youssef", catalog)?.id).toBe("pt-y");
  });
});

describe("expandSheetTokens", () => {
  it("expands every sheet abbreviation", () => {
    const cases: Array<[string, string[]]> = [
      ["FT", ["functional", "training"]],
      ["ST", ["studio"]],
      ["UMS", ["ultimate", "mindspacer"]],
      ["PT", ["personal", "training"]],
      ["SM", ["spacer", "mix"]],
      ["OG", ["open", "gym"]],
      ["Mat", ["mat", "pilates"]],
      ["Ref", ["reformer", "pilates"]],
      ["RF", ["rope", "flow"]],
      ["Cond", ["conditioning"]],
      ["Str", ["strength"]],
      ["LW", ["ladies", "workout"]],
      ["PP", ["prenatal", "postpartum"]],
      ["Hyrox", ["hyrox"]],
    ];
    for (const [raw, expanded] of cases) {
      expect(expandSheetTokens(raw, "replace")).toEqual(expanded);
    }
  });

  it("expands Pre/Post written out", () => {
    expect(expandSheetTokens("Pre/Post", "replace")).toEqual([
      "pre",
      "post",
      "prenatal",
      "postpartum",
    ]);
  });

  it("keeps the shorthand alongside the expansion when appending", () => {
    expect(expandSheetTokens("10 FT")).toEqual([
      "10",
      "ft",
      "functional",
      "training",
    ]);
  });

  it("only expands standalone tokens", () => {
    expect(expandSheetTokens("Stretch", "replace")).toEqual(["stretch"]);
    expect(expandSheetTokens("Reformer", "replace")).toEqual(["reformer"]);
  });
});

describe("sheetAbbreviationCategory", () => {
  it("maps category shorthand to a class category", () => {
    expect(sheetAbbreviationCategory("FT")).toBe("FUNCTIONAL_TRAINING");
    expect(sheetAbbreviationCategory("st")).toBe("STUDIO");
    expect(sheetAbbreviationCategory("OG")).toBe("WORKSPACE");
  });

  it("ignores title shorthand and multi-word headers", () => {
    expect(sheetAbbreviationCategory("Cond")).toBeNull();
    expect(sheetAbbreviationCategory("FT Strength")).toBeNull();
  });
});
