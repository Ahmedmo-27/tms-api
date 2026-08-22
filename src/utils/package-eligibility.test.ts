import {
  selectEligiblePackage,
  type EligibilityPackage,
} from "./package-eligibility";

const NOW = new Date("2026-08-21T10:00:00Z");

function pkg(overrides: Partial<EligibilityPackage>): EligibilityPackage {
  return {
    pkgId: "studio",
    name: "20 Studio",
    status: "ACTIVE",
    pkgStartDate: new Date("2026-08-01T00:00:00Z"),
    pkgEndDate: new Date("2026-09-01T00:00:00Z"),
    remainingClasses: 10,
    ...overrides,
  };
}

describe("selectEligiblePackage", () => {
  it("picks the active package that opens the class", () => {
    const result = selectEligiblePackage({
      packages: [pkg({ pkgId: "ft", name: "10 Functional Training" }), pkg({})],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toEqual({ ok: true, pkg: expect.objectContaining({ name: "20 Studio" }) });
  });

  it("prefers the package that started first", () => {
    const result = selectEligiblePackage({
      packages: [
        pkg({ pkgId: "studio", name: "New Studio", pkgStartDate: new Date("2026-08-15T00:00:00Z") }),
        pkg({ pkgId: "studio", name: "Older Studio", pkgStartDate: new Date("2026-08-02T00:00:00Z") }),
      ],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, pkg: { name: "Older Studio" } });
  });

  it("reports PACKAGE_DOES_NOT_OPEN_CLASS when the active packages cover other classes", () => {
    const result = selectEligiblePackage({
      packages: [pkg({ pkgId: "ft", name: "10 Functional Training" })],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PACKAGE_DOES_NOT_OPEN_CLASS",
      context: { packageNames: ["10 Functional Training"] },
    });
  });

  it("reports NO_PACKAGES_ON_ACCOUNT when account has 0 packages", () => {
    const result = selectEligiblePackage({
      packages: [],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, code: "NO_PACKAGES_ON_ACCOUNT" });
  });

  it("reports PACKAGE_EXPIRED with package details when matching package is expired", () => {
    const result = selectEligiblePackage({
      packages: [pkg({ status: "EXPIRED", pkgEndDate: new Date("2026-08-10T00:00:00Z") })],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PACKAGE_EXPIRED",
      context: { packageName: "20 Studio" },
    });
  });

  it("skips expired and used-up packages before failing", () => {
    const expired = selectEligiblePackage({
      packages: [pkg({ pkgEndDate: new Date("2026-08-10T00:00:00Z") })],
      allowedPkgIds: ["studio"],
      now: NOW,
    });
    const drained = selectEligiblePackage({
      packages: [pkg({ remainingClasses: 0 })],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(expired).toMatchObject({
      ok: false,
      code: "PACKAGE_EXPIRED",
      context: { packageName: "20 Studio" },
    });
    expect(drained).toMatchObject({
      ok: false,
      code: "NO_REMAINING_SESSIONS",
      context: { packageName: "20 Studio" },
    });
  });

  it("falls through an expired package to a usable one", () => {
    const result = selectEligiblePackage({
      packages: [
        pkg({
          name: "Old Studio",
          pkgStartDate: new Date("2026-07-01T00:00:00Z"),
          pkgEndDate: new Date("2026-08-01T00:00:00Z"),
        }),
        pkg({ name: "Current Studio" }),
      ],
      allowedPkgIds: ["studio"],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, pkg: { name: "Current Studio" } });
  });

  it("honours a monthly class restriction that is used up", () => {
    const result = selectEligiblePackage({
      packages: [
        pkg({
          classRestrictionsRecord: [
            { cid: "class-1", record: [{ month: "82026", remainingSessions: 0 }] },
          ],
        }),
      ],
      allowedPkgIds: ["studio"],
      cid: "class-1",
      month: "82026",
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "CLASS_RESTRICTION_REACHED",
      context: { packageName: "20 Studio" },
    });
  });

  it("allows a restricted class that still has sessions this month", () => {
    const result = selectEligiblePackage({
      packages: [
        pkg({
          classRestrictionsRecord: [
            { cid: "class-1", record: [{ month: "82026", remainingSessions: 2 }] },
          ],
        }),
      ],
      allowedPkgIds: ["studio"],
      cid: "class-1",
      month: "82026",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true });
  });
});
