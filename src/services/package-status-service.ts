import { Types } from "mongoose";
import Member, { IMember, IMemberPackageData } from "../models/member";
import Package, { isUnlimitedSpaceAccess } from "../models/package";
import logger from "../config/logger";

export type PackageEffectiveStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "COMPLETED"
  | "FROZEN"
  | "DELETED";

/**
 * Checks if a package grants open gym / space access (e.g. MIXED, OPEN_GYM, SPACE_MEMBERSHIP, ULTIMATE_MINDSPACER).
 */
export function isSpaceEligiblePackage(
  pkg: {
    category?: string;
    name?: string;
    pkgId?: any;
  },
  category?: string
): boolean {
  const cat =
    category ||
    pkg.category ||
    (typeof pkg.pkgId === "object" && pkg.pkgId?.category ? pkg.pkgId.category : "");
  if (cat) {
    return isUnlimitedSpaceAccess(cat);
  }
  const name =
    pkg.name ||
    (typeof pkg.pkgId === "object" && pkg.pkgId?.name ? pkg.pkgId.name : "");
  if (name) {
    return /spacer\s*mix|open\s*gym|ultimate\s*mindspacer|space\s*membership/i.test(name);
  }
  return false;
}

/**
 * Resolves the effective status of a member package given current time and package state.
 */
export function resolvePackageStatus(
  pkg: {
    status?: string;
    pkgEndDate?: Date | string;
    pkgStartDate?: Date | string;
    remainingClasses?: number;
    name?: string;
    category?: string;
    pkgId?: any;
    freezeInfo?: {
      isFrozen?: boolean;
      freezeEndDate?: Date | string;
    };
  },
  now: Date = new Date(),
  category?: string
): PackageEffectiveStatus {
  // If explicitly deleted, retain deleted state
  if (pkg.status === "DELETED") {
    return "DELETED";
  }

  // If frozen, check if the freeze has ended
  const isFrozen = pkg.status === "FROZEN" || Boolean(pkg.freezeInfo?.isFrozen);
  if (isFrozen) {
    if (
      pkg.freezeInfo?.freezeEndDate &&
      now >= new Date(pkg.freezeInfo.freezeEndDate)
    ) {
      // Freeze has ended; evaluate normal status based on end date and credits
    } else {
      return "FROZEN";
    }
  }

  // Expiration check: if pkgEndDate is strictly before now
  if (pkg.pkgEndDate) {
    const endDate = new Date(pkg.pkgEndDate);
    if (!isNaN(endDate.getTime()) && endDate < now) {
      return "EXPIRED";
    }
  }

  // Depleted sessions check: if remainingClasses <= 0
  // For packages with open gym/space access (e.g. MIXED / Spacer Mix, OPEN_GYM, ULTIMATE_MINDSPACER),
  // depleting scheduled class credits does NOT complete the package while it is within its validity period (pkgEndDate >= now).
  // It remains ACTIVE for open gym until pkgEndDate.
  const hasSpaceAccess = isSpaceEligiblePackage(pkg, category);
  if (
    !hasSpaceAccess &&
    typeof pkg.remainingClasses === "number" &&
    pkg.remainingClasses <= 0
  ) {
    return "COMPLETED";
  }

  return "ACTIVE";
}

export class PackageStatusService {
  /**
   * Synchronizes and mutates in-memory package statuses on a Member document.
   * Auto-unfreezes packages whose freeze period has elapsed.
   * Returns true if any package was modified.
   */
  static syncMemberPackageStatuses(
    member: IMember,
    now: Date = new Date(),
    categoryByPkgId?: Map<string, string>
  ): boolean {
    if (!member || !Array.isArray(member.packages)) return false;

    let modified = false;

    for (const pkg of member.packages) {
      // Check auto-unfreeze
      if (pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen) {
        if (
          pkg.freezeInfo?.freezeEndDate &&
          now >= new Date(pkg.freezeInfo.freezeEndDate)
        ) {
          if (pkg.freezeInfo) {
            pkg.freezeInfo.isFrozen = false;
          }
          modified = true;
          logger.info(
            `Auto-unfroze package ${pkg.pkgId} for member ${member.uid}`
          );
        }
      }

      const cat = categoryByPkgId?.get(pkg.pkgId?.toString());
      const expectedStatus = resolvePackageStatus(pkg, now, cat);
      if (pkg.status !== expectedStatus) {
        pkg.status = expectedStatus;
        modified = true;
      }
    }

    return modified;
  }

  /**
   * Bulk database synchronization:
   * 1. Marks all active packages whose pkgEndDate < now as EXPIRED.
   * 2. Marks all active packages whose remainingClasses <= 0 as COMPLETED (for non-space packages).
   * 3. Restores space-eligible packages with remainingClasses <= 0 and pkgEndDate >= now to ACTIVE.
   * 4. Syncs frozen packages whose freeze period ended.
   */
  static async syncAllPackageStatuses(
    now: Date = new Date()
  ): Promise<{ updatedMembers: number; updatedPkgs: number }> {
    let updatedMembers = 0;
    let updatedPkgs = 0;

    try {
      // Fetch all catalog packages to map categories
      const catalogPkgs = await Package.find({}).select("_id category name");
      const categoryByPkgId = new Map(
        catalogPkgs.map((p) => [p._id.toString(), p.category])
      );

      // Find members with packages that might need status updates
      const members = await Member.find({
        $or: [
          {
            "packages.status": "ACTIVE",
            "packages.pkgEndDate": { $lt: now },
          },
          {
            "packages.status": "ACTIVE",
            "packages.remainingClasses": { $lte: 0 },
          },
          {
            "packages.status": "COMPLETED",
            "packages.pkgEndDate": { $gte: now },
          },
          {
            "packages.status": "FROZEN",
            "packages.freezeInfo.freezeEndDate": { $lte: now },
          },
          {
            "packages.freezeInfo.isFrozen": true,
            "packages.freezeInfo.freezeEndDate": { $lte: now },
          },
        ],
      });

      for (const member of members) {
        let memberUpdated = false;

        for (const pkg of member.packages) {
          // Check auto-unfreeze
          if (pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen) {
            if (
              pkg.freezeInfo?.freezeEndDate &&
              now >= new Date(pkg.freezeInfo.freezeEndDate)
            ) {
              if (pkg.freezeInfo) {
                pkg.freezeInfo.isFrozen = false;
              }
              memberUpdated = true;
            }
          }

          const cat = categoryByPkgId.get(pkg.pkgId?.toString());
          const expectedStatus = resolvePackageStatus(pkg, now, cat);
          if (pkg.status !== expectedStatus) {
            pkg.status = expectedStatus;
            memberUpdated = true;
            updatedPkgs++;
          }
        }

        if (memberUpdated) {
          await member.save();
          updatedMembers++;
        }
      }

      if (updatedPkgs > 0 || updatedMembers > 0) {
        logger.info(
          `[PackageStatusService] Synchronized package statuses. Updated ${updatedPkgs} package(s) across ${updatedMembers} member(s).`
        );
      }
    } catch (error) {
      logger.error("[PackageStatusService] Error syncing package statuses:", error);
    }

    return { updatedMembers, updatedPkgs };
  }
}
