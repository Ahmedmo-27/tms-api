import { Types } from "mongoose";
import {
  collectBranchLabels,
  decidePackageLocationMigration,
} from "../utils/package-location-migration";

/**
 * Fixture mirror of a typical catalog: generic packages wrongly scoped to
 * Cairo should clear; branch-named open gym / membership titles should keep.
 */
describe("migrate-packages-to-all-locations decisions", () => {
  const cairoId = new Types.ObjectId().toString();
  const matchaId = new Types.ObjectId().toString();

  const labels = collectBranchLabels([
    { branchName: "The Mind Space", location: "New Cairo" },
    { branchName: "Matcha", location: "Matcha North Coast" },
  ]);

  const catalog = [
    { name: "10 Studio", category: "STUDIO", locationId: cairoId },
    { name: "1 Month Ultimate Mindspacer", category: "ULTIMATE_MINDSPACER", locationId: cairoId },
    { name: "1 Month Space Membership", category: "SPACE_MEMBERSHIP", locationId: cairoId },
    { name: "Open Gym Weekly — Cairo", category: "OPEN_GYM", locationId: cairoId },
    { name: "Open Gym Matcha 14d", category: "OPEN_GYM", locationId: matchaId },
    { name: "1 Month Space Membership New Cairo", category: "SPACE_MEMBERSHIP", locationId: cairoId },
    { name: "5 Studio", category: "STUDIO", locationId: null },
  ];

  it("clears only location-scoped packages without a branch name in the title", () => {
    const decisions = catalog.map((pkg, i) =>
      decidePackageLocationMigration(
        { _id: new Types.ObjectId(), ...pkg },
        labels,
      ),
    );

    const cleared = decisions
      .filter((d) => d.action === "clear_location")
      .map((d) => d.name)
      .sort();
    const keptNamed = decisions
      .filter(
        (d) =>
          d.action === "keep" && d.reason === "branch_name_in_package_name",
      )
      .map((d) => d.name)
      .sort();
    const alreadyAll = decisions
      .filter(
        (d) => d.action === "keep" && d.reason === "already_all_locations",
      )
      .map((d) => d.name);

    expect(cleared).toEqual([
      "1 Month Space Membership",
      "1 Month Ultimate Mindspacer",
      "10 Studio",
    ]);
    expect(keptNamed).toEqual([
      "1 Month Space Membership New Cairo",
      "Open Gym Matcha 14d",
      "Open Gym Weekly — Cairo",
    ]);
    expect(alreadyAll).toEqual(["5 Studio"]);
  });
});
