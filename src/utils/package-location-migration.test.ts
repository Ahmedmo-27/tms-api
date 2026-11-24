import { Types } from "mongoose";
import {
  collectBranchLabels,
  decidePackageLocationMigration,
  packageNameContainsBranchLabel,
} from "./package-location-migration";

describe("package-location-migration", () => {
  const locations = [
    { branchName: "The Mind Space", location: "New Cairo" },
    { branchName: "Matcha", location: "Matcha North Coast" },
  ];

  const labels = collectBranchLabels(locations);

  it("collects branchName, location, and default aliases without duplicates", () => {
    expect(labels).toEqual(
      expect.arrayContaining([
        "The Mind Space",
        "New Cairo",
        "Matcha",
        "Matcha North Coast",
        "Cairo",
      ]),
    );
    expect(new Set(labels).size).toBe(labels.length);
    // Longer labels come first so matching prefers "New Cairo" over "Cairo".
    expect(labels.indexOf("New Cairo")).toBeLessThan(labels.indexOf("Cairo"));
  });

  it("detects branch labels in package names", () => {
    expect(
      packageNameContainsBranchLabel("Open Gym Monthly — Cairo", labels),
    ).toEqual({ matched: true, label: "Cairo" });

    expect(
      packageNameContainsBranchLabel("1 Month Space Membership New Cairo", labels),
    ).toEqual({ matched: true, label: "New Cairo" });

    expect(
      packageNameContainsBranchLabel("Open Gym Matcha 14d", labels),
    ).toEqual({ matched: true, label: "Matcha" });
  });

  it("does not treat Mindspacer as Mind Space", () => {
    expect(
      packageNameContainsBranchLabel("1 Month Ultimate Mindspacer", labels),
    ).toEqual({ matched: false });
  });

  it("does not match a label glued to Arabic letters", () => {
    expect(
      packageNameContainsBranchLabel("عضويةCairo", labels),
    ).toEqual({ matched: false });
  });

  it("still matches a label next to Arabic when separated", () => {
    expect(
      packageNameContainsBranchLabel("عضوية Cairo", labels),
    ).toEqual({ matched: true, label: "Cairo" });
  });

  it("keeps packages that already have all-locations scope", () => {
    const decision = decidePackageLocationMigration(
      {
        _id: new Types.ObjectId(),
        name: "10 Studio",
        category: "STUDIO",
        locationId: null,
      },
      labels,
    );
    expect(decision).toMatchObject({
      action: "keep",
      reason: "already_all_locations",
      locationId: null,
    });
  });

  it("keeps packages whose name includes a branch label", () => {
    const locationId = new Types.ObjectId();
    const decision = decidePackageLocationMigration(
      {
        _id: new Types.ObjectId(),
        name: "Open Gym Weekly — Cairo",
        category: "OPEN_GYM",
        locationId,
      },
      labels,
    );
    expect(decision).toMatchObject({
      action: "keep",
      reason: "branch_name_in_package_name",
      matchedLabel: "Cairo",
      locationId: locationId.toString(),
    });
  });

  it("clears locationId when the package name has no branch label", () => {
    const locationId = new Types.ObjectId();
    const decision = decidePackageLocationMigration(
      {
        _id: new Types.ObjectId(),
        name: "10 Studio",
        category: "STUDIO",
        locationId,
      },
      labels,
    );
    expect(decision).toEqual({
      action: "clear_location",
      reason: "no_branch_name_in_package_name",
      packageId: expect.any(String),
      name: "10 Studio",
      category: "STUDIO",
      locationId: locationId.toString(),
    });
  });

  it("clears generic space memberships that were wrongly branch-scoped", () => {
    const locationId = new Types.ObjectId();
    const decision = decidePackageLocationMigration(
      {
        _id: new Types.ObjectId(),
        name: "1 Month Space Membership",
        category: "SPACE_MEMBERSHIP",
        locationId,
      },
      labels,
    );
    expect(decision.action).toBe("clear_location");
  });
});
