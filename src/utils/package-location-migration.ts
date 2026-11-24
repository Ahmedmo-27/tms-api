/**
 * Helpers for migrating catalog packages from a single-branch locationId
 * to "all locations" (locationId = null), while keeping packages that are
 * intentionally branch-scoped via a branch name in their title.
 */

import { escapeRegex } from "./escapeRegex";

/** Extra aliases that show up in package names but may not be Location.branchName. */
export const DEFAULT_BRANCH_NAME_ALIASES = [
  "Cairo",
  "New Cairo",
  "Matcha",
  "The Mind Space",
  "Mind Space",
  "North Coast",
  "Zamalek",
] as const;

export type BranchLabelSource = {
  branchName?: string | null;
  location?: string | null;
};

/**
 * Build the set of labels used to detect a branch name inside a package title.
 * Includes Location.branchName, Location.location, and well-known aliases.
 */
export function collectBranchLabels(
  locations: BranchLabelSource[],
  extraAliases: readonly string[] = DEFAULT_BRANCH_NAME_ALIASES,
): string[] {
  const labels = new Set<string>();

  for (const loc of locations) {
    const branch = loc.branchName?.trim();
    if (branch) labels.add(branch);
    const place = loc.location?.trim();
    if (place) labels.add(place);
  }

  for (const alias of extraAliases) {
    const trimmed = alias.trim();
    if (trimmed) labels.add(trimmed);
  }

  // Longer labels first so "New Cairo" wins over "Cairo" when reporting a match.
  return [...labels].sort((a, b) => b.length - a.length);
}

/**
 * True when the package name contains a known branch / place label.
 * Uses word-ish boundaries so "Mindspacer" does not match "Mind Space".
 */
export function packageNameContainsBranchLabel(
  packageName: string,
  branchLabels: readonly string[],
): { matched: boolean; label?: string } {
  const name = (packageName || "").trim();
  if (!name || branchLabels.length === 0) {
    return { matched: false };
  }

  for (const label of branchLabels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9])${escapeRegex(trimmed)}([^A-Za-z0-9]|$)`,
      "i",
    );
    if (pattern.test(name)) {
      return { matched: true, label: trimmed };
    }
  }

  return { matched: false };
}

export type CatalogPackageLocationRow = {
  _id: { toString(): string };
  name: string;
  category?: string;
  locationId?: { toString(): string } | string | null;
  isDeprecated?: boolean;
  hidden?: boolean;
};

export type PackageLocationMigrationDecision =
  | {
      action: "keep";
      reason: "already_all_locations" | "branch_name_in_package_name";
      packageId: string;
      name: string;
      category?: string;
      locationId: string | null;
      matchedLabel?: string;
    }
  | {
      action: "clear_location";
      reason: "no_branch_name_in_package_name";
      packageId: string;
      name: string;
      category?: string;
      locationId: string;
    };

/**
 * Decide whether a catalog package should keep its locationId or become
 * all-locations (null). Packages without a locationId are already all-locations.
 */
export function decidePackageLocationMigration(
  pkg: CatalogPackageLocationRow,
  branchLabels: readonly string[],
): PackageLocationMigrationDecision {
  const packageId = pkg._id.toString();
  const rawLocation = pkg.locationId;
  const locationId =
    rawLocation === undefined || rawLocation === null
      ? null
      : rawLocation.toString();

  if (!locationId) {
    return {
      action: "keep",
      reason: "already_all_locations",
      packageId,
      name: pkg.name,
      category: pkg.category,
      locationId: null,
    };
  }

  const { matched, label } = packageNameContainsBranchLabel(
    pkg.name,
    branchLabels,
  );

  if (matched) {
    return {
      action: "keep",
      reason: "branch_name_in_package_name",
      packageId,
      name: pkg.name,
      category: pkg.category,
      locationId,
      matchedLabel: label,
    };
  }

  return {
    action: "clear_location",
    reason: "no_branch_name_in_package_name",
    packageId,
    name: pkg.name,
    category: pkg.category,
    locationId,
  };
}
