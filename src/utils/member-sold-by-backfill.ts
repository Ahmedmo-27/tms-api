import { Types } from "mongoose";

export const isDeletedPackageStatus = (status: string) =>
  String(status).toUpperCase() === "DELETED";

export type BackfillPackageInput = {
  _id: string;
  status: string;
  soldBy?: string | Types.ObjectId | null;
  soldByAssignedAt?: Date | null;
  soldByAssignedBy?: string | Types.ObjectId | null;
  pkgStartDate?: Date | null;
};

export type BackfillMemberInput = {
  memberId: string;
  uid?: string;
  soldBy?: string | Types.ObjectId | null;
  soldByAssignedAt?: Date | null;
  soldByAssignedBy?: string | Types.ObjectId | null;
  packages: BackfillPackageInput[];
};

export type SoldByConflictLog = {
  memberId: string;
  uid?: string;
  sellerIds: string[];
  chosenSellerId: string;
  tieBreak: "soldByAssignedAt" | "pkgStartDate" | "packageId";
};

export type SoldByAttribution = {
  soldBy: string;
  soldByAssignedAt: Date | null;
  soldByAssignedBy: string | null;
};

export type MemberSoldByBackfillPlan = {
  memberId: string;
  uid?: string;
  attribution: SoldByAttribution;
  /** Non-deleted package ids whose soldBy fields will change. */
  packageIdsToUpdate: string[];
  /** True when member-level soldBy fields change. */
  memberFieldsChanged: boolean;
  conflict?: SoldByConflictLog;
};

const idStr = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  return raw.length ? raw : null;
};

const recencyTuple = (pkg: BackfillPackageInput): [number, number, string] => {
  const at = pkg.soldByAssignedAt
    ? new Date(pkg.soldByAssignedAt).getTime()
  : 0;
  const start = pkg.pkgStartDate ? new Date(pkg.pkgStartDate).getTime() : 0;
  return [at, start, pkg._id];
};

/**
 * Picks the package row that best represents the winning seller (metadata source).
 * Prefers latest soldByAssignedAt, then pkgStartDate, then stable package id.
 */
export function pickSourcePackage(
  packages: BackfillPackageInput[],
  sellerId: string,
): BackfillPackageInput | undefined {
  return packages
    .filter(
      (pkg) =>
        !isDeletedPackageStatus(pkg.status) &&
        idStr(pkg.soldBy) === sellerId,
    )
    .sort((a, b) => {
      const ta = recencyTuple(a);
      const tb = recencyTuple(b);
      if (tb[0] !== ta[0]) return tb[0] - ta[0];
      if (tb[1] !== ta[1]) return tb[1] - ta[1];
      return tb[2].localeCompare(ta[2]);
    })[0];
}

/**
 * When legacy package rows disagree on seller, pick one deterministically:
 * latest soldByAssignedAt, else latest pkgStartDate, else lexicographically
 * smallest package id (stable tie-break).
 */
export function resolveConflictingSeller(
  assignedPackages: BackfillPackageInput[],
): { sellerId: string; tieBreak: SoldByConflictLog["tieBreak"] } {
  const bySeller = new Map<string, BackfillPackageInput[]>();
  for (const pkg of assignedPackages) {
    const seller = idStr(pkg.soldBy);
    if (!seller) continue;
    const list = bySeller.get(seller) ?? [];
    list.push(pkg);
    bySeller.set(seller, list);
  }

  let bestSeller = "";
  let bestTuple: [number, number, string] = [-1, -1, ""];
  let tieBreak: SoldByConflictLog["tieBreak"] = "packageId";

  for (const [sellerId, pkgs] of bySeller) {
    const bestPkg = pkgs.sort((a, b) => {
      const ta = recencyTuple(a);
      const tb = recencyTuple(b);
      if (tb[0] !== ta[0]) return tb[0] - ta[0];
      if (tb[1] !== ta[1]) return tb[1] - ta[1];
      return tb[2].localeCompare(ta[2]);
    })[0];
    const tuple = recencyTuple(bestPkg);
    if (
      tuple[0] > bestTuple[0] ||
      (tuple[0] === bestTuple[0] && tuple[1] > bestTuple[1]) ||
      (tuple[0] === bestTuple[0] &&
        tuple[1] === bestTuple[1] &&
        tuple[2].localeCompare(bestTuple[2]) < 0)
    ) {
      bestSeller = sellerId;
      bestTuple = tuple;
      tieBreak =
        tuple[0] > 0
          ? "soldByAssignedAt"
          : tuple[1] > 0
            ? "pkgStartDate"
            : "packageId";
    }
  }

  return { sellerId: bestSeller, tieBreak };
}

function attributionFromSource(
  sellerId: string,
  source: BackfillPackageInput | undefined,
  member: BackfillMemberInput,
  migrationRunAt: Date,
): SoldByAttribution {
  const fromMember = idStr(member.soldBy) === sellerId ? member : undefined;
  const base = source ?? fromMember;

  const soldByAssignedAt =
    (fromMember?.soldByAssignedAt as Date | undefined) ??
    (base && "soldByAssignedAt" in base
      ? (base.soldByAssignedAt as Date | null)
      : null) ??
    migrationRunAt;

  const soldByAssignedBy =
    idStr(fromMember?.soldByAssignedBy) ??
    (base && "soldByAssignedBy" in base
      ? idStr(base.soldByAssignedBy)
      : null);

  return {
    soldBy: sellerId,
    soldByAssignedAt,
    soldByAssignedBy,
  };
}

/**
 * Plans member-level sales attribution backfill for one member document.
 * Returns null when the member is already fully in sync or has nothing to backfill.
 */
export function planMemberSoldByBackfill(
  member: BackfillMemberInput,
  migrationRunAt: Date = new Date(),
): MemberSoldByBackfillPlan | null {
  const activePackages = member.packages.filter(
    (pkg) => !isDeletedPackageStatus(pkg.status),
  );
  const assignedPackages = activePackages.filter((pkg) => idStr(pkg.soldBy));

  const memberSeller = idStr(member.soldBy);
  let chosenSeller = memberSeller;
  let conflict: SoldByConflictLog | undefined;

  if (chosenSeller) {
    const packageSellers = new Set(
      assignedPackages.map((pkg) => idStr(pkg.soldBy)).filter(Boolean) as string[],
    );
    if (packageSellers.size > 1) {
      conflict = {
        memberId: member.memberId,
        uid: member.uid,
        sellerIds: [...packageSellers].sort(),
        chosenSellerId: chosenSeller,
        tieBreak: "soldByAssignedAt",
      };
    } else if (
      packageSellers.size === 1 &&
      !packageSellers.has(chosenSeller)
    ) {
      conflict = {
        memberId: member.memberId,
        uid: member.uid,
        sellerIds: [...packageSellers].sort(),
        chosenSellerId: chosenSeller,
        tieBreak: "soldByAssignedAt",
      };
    }
  } else if (assignedPackages.length === 0) {
    return null;
  } else {
    const uniqueSellers = new Set(
      assignedPackages.map((pkg) => idStr(pkg.soldBy)).filter(Boolean) as string[],
    );
    if (uniqueSellers.size === 1) {
      chosenSeller = [...uniqueSellers][0];
    } else {
      const resolved = resolveConflictingSeller(assignedPackages);
      chosenSeller = resolved.sellerId;
      conflict = {
        memberId: member.memberId,
        uid: member.uid,
        sellerIds: [...uniqueSellers].sort(),
        chosenSellerId: chosenSeller,
        tieBreak: resolved.tieBreak,
      };
    }
  }

  if (!chosenSeller) return null;

  const sourcePackage = pickSourcePackage(member.packages, chosenSeller);
  const attribution = attributionFromSource(
    chosenSeller,
    sourcePackage,
    member,
    migrationRunAt,
  );

  const packageIdsToUpdate = activePackages
    .filter((pkg) => idStr(pkg.soldBy) !== chosenSeller)
    .map((pkg) => pkg._id);

  const memberFieldsChanged =
    memberSeller !== chosenSeller ||
    idStr(member.soldByAssignedBy) !== attribution.soldByAssignedBy ||
    (member.soldByAssignedAt?.getTime() ?? null) !==
      (attribution.soldByAssignedAt?.getTime() ?? null);

  if (!memberFieldsChanged && packageIdsToUpdate.length === 0) {
    return null;
  }

  return {
    memberId: member.memberId,
    uid: member.uid,
    attribution,
    packageIdsToUpdate,
    memberFieldsChanged,
    conflict,
  };
}

export type ApplySoldByBackfillOptions = {
  migrationRunAt?: Date;
};

/**
 * Returns updated package attribution fields for a member (does not persist).
 */
export function applySoldByBackfillToPackages(
  packages: BackfillPackageInput[],
  plan: MemberSoldByBackfillPlan,
  options: ApplySoldByBackfillOptions = {},
): BackfillPackageInput[] {
  const migrationRunAt = options.migrationRunAt ?? new Date();
  const source = pickSourcePackage(packages, plan.attribution.soldBy);

  return packages.map((pkg) => {
    if (isDeletedPackageStatus(pkg.status)) {
      return pkg;
    }
    if (!plan.packageIdsToUpdate.includes(pkg._id)) {
      return pkg;
    }

    return {
      ...pkg,
      soldBy: plan.attribution.soldBy,
      soldByAssignedAt:
        (source?.soldByAssignedAt as Date | undefined) ??
        plan.attribution.soldByAssignedAt ??
        migrationRunAt,
      soldByAssignedBy:
        idStr(source?.soldByAssignedBy) ?? plan.attribution.soldByAssignedBy,
    };
  });
}