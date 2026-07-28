import { Types } from "mongoose";
import { memberPackageGrantsAccessAtLocation } from "./open-gym-location";

describe("memberPackageGrantsAccessAtLocation (multi-branch scanning)", () => {
  const cairoId = new Types.ObjectId().toString();
  const matchaId = new Types.ObjectId().toString();
  const otherId = new Types.ObjectId().toString();

  it("grants access when member package location matches scan branch", () => {
    expect(
      memberPackageGrantsAccessAtLocation(
        new Types.ObjectId(cairoId),
        null,
        cairoId,
      ),
    ).toBe(true);
  });

  it("denies access when member package is for a different branch", () => {
    expect(
      memberPackageGrantsAccessAtLocation(
        new Types.ObjectId(cairoId),
        null,
        matchaId,
      ),
    ).toBe(false);
  });

  it("falls back to catalog package location when member package has none", () => {
    expect(
      memberPackageGrantsAccessAtLocation(
        null,
        new Types.ObjectId(matchaId),
        matchaId,
      ),
    ).toBe(true);
    expect(
      memberPackageGrantsAccessAtLocation(
        null,
        new Types.ObjectId(matchaId),
        cairoId,
      ),
    ).toBe(false);
  });

  it("member package location wins over catalog location", () => {
    expect(
      memberPackageGrantsAccessAtLocation(
        new Types.ObjectId(cairoId),
        new Types.ObjectId(matchaId),
        cairoId,
      ),
    ).toBe(true);
    expect(
      memberPackageGrantsAccessAtLocation(
        new Types.ObjectId(cairoId),
        new Types.ObjectId(matchaId),
        matchaId,
      ),
    ).toBe(false);
  });

  it("allows any branch when neither member nor catalog location is set (legacy)", () => {
    expect(memberPackageGrantsAccessAtLocation(null, null, cairoId)).toBe(true);
    expect(memberPackageGrantsAccessAtLocation(null, null, matchaId)).toBe(
      true,
    );
  });

  describe("member holding packages from two branches (APP purchase result)", () => {
    const cairoPkg = {
      pkgId: new Types.ObjectId(),
      locationId: new Types.ObjectId(cairoId),
      catalogLocationId: new Types.ObjectId(cairoId),
      name: "Open Gym Cairo",
    };
    const matchaPkg = {
      pkgId: new Types.ObjectId(),
      locationId: new Types.ObjectId(matchaId),
      catalogLocationId: new Types.ObjectId(matchaId),
      name: "Open Gym Matcha",
    };
    const studioMainPkg = {
      pkgId: new Types.ObjectId(),
      locationId: new Types.ObjectId(cairoId), // APP fix pins studio to main/Cairo
      catalogLocationId: null as Types.ObjectId | null,
      name: "10 Studio",
    };

    function eligibleAt(
      packages: Array<{
        pkgId: Types.ObjectId;
        locationId: Types.ObjectId;
        catalogLocationId: Types.ObjectId | null;
        name: string;
      }>,
      scanLocationId: string,
    ) {
      return packages.filter((p) =>
        memberPackageGrantsAccessAtLocation(
          p.locationId,
          p.catalogLocationId,
          scanLocationId,
        ),
      );
    }

    it("Cairo scan uses only Cairo open gym (not Matcha)", () => {
      const eligible = eligibleAt([cairoPkg, matchaPkg], cairoId);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].name).toBe("Open Gym Cairo");
    });

    it("Matcha scan uses only Matcha open gym (not Cairo)", () => {
      const eligible = eligibleAt([cairoPkg, matchaPkg], matchaId);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].name).toBe("Open Gym Matcha");
    });

    it("both branch packages are usable — each at its own branch", () => {
      expect(eligibleAt([cairoPkg, matchaPkg], cairoId)).toHaveLength(1);
      expect(eligibleAt([cairoPkg, matchaPkg], matchaId)).toHaveLength(1);
    });

    it("third branch scan grants no package access", () => {
      expect(eligibleAt([cairoPkg, matchaPkg], otherId)).toHaveLength(0);
    });

    it("Cairo open gym + main-pinned studio both work at Cairo scan", () => {
      const eligible = eligibleAt([cairoPkg, studioMainPkg], cairoId);
      expect(eligible.map((p) => p.name).sort()).toEqual([
        "10 Studio",
        "Open Gym Cairo",
      ]);
    });

    it("main-pinned studio does not unlock Matcha open gym scan", () => {
      const eligible = eligibleAt([cairoPkg, studioMainPkg], matchaId);
      expect(eligible).toHaveLength(0);
    });

    it("after buying Matcha open gym as well, Matcha scan works without breaking Cairo", () => {
      const all = [cairoPkg, matchaPkg, studioMainPkg];
      expect(eligibleAt(all, cairoId).map((p) => p.name).sort()).toEqual([
        "10 Studio",
        "Open Gym Cairo",
      ]);
      expect(eligibleAt(all, matchaId).map((p) => p.name)).toEqual([
        "Open Gym Matcha",
      ]);
    });
  });
});
