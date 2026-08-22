import {
  BookingPackageFailureCode,
  BookingPackageSkipReason,
  bookingPackageErrorMessage,
  formatDateShort,
  resolveBookingPackageFailure,
} from "./booking-package-errors";

export type EligibilityPackage = {
  pkgId: string;
  name: string;
  status: string;
  pkgStartDate: Date | string;
  pkgEndDate: Date | string;
  remainingClasses: number;
  classRestrictionsRecord?: Array<{
    cid: unknown;
    record?: Array<{ month: string; remainingSessions: number }>;
  }>;
};

export type EligibilityFailureContext = {
  packageName?: string;
  packageNames?: string[];
  date?: string;
  limit?: number;
  remainingClasses?: number;
};

export type EligibilityResult =
  | { ok: true; pkg: EligibilityPackage }
  | {
      ok: false;
      code: BookingPackageFailureCode;
      context?: EligibilityFailureContext;
    };

function isRestricted(
  pkg: EligibilityPackage,
  cid: string,
  month: string,
): boolean {
  if (!pkg.classRestrictionsRecord) return false;
  return pkg.classRestrictionsRecord.some((restriction) => {
    if (String(restriction.cid) !== cid) return false;
    return (restriction.record || []).some(
      (entry) => entry.month === month && entry.remainingSessions === 0,
    );
  });
}

/**
 * Read-only preview of the package a check-in would spend. Mirrors the order
 * and skip rules of Member.saveBooking / recordPtAttendance without touching
 * the member document, so the sheet and UI can show the outcome before saving.
 */
export function selectEligiblePackage(input: {
  packages: EligibilityPackage[];
  allowedPkgIds: string[];
  cid?: string;
  month?: string;
  now?: Date;
}): EligibilityResult {
  const now = input.now ?? new Date();
  const allowed = new Set(input.allowedPkgIds.map((id) => String(id)));

  if (!input.packages || input.packages.length === 0) {
    return {
      ok: false,
      code: "NO_PACKAGES_ON_ACCOUNT",
    };
  }

  const hasAnyActivePackage = input.packages.some(
    (pkg) => pkg.status === "ACTIVE",
  );
  const activePackages = input.packages.filter((pkg) => pkg.status === "ACTIVE");

  const matchingAll = input.packages.filter((pkg) =>
    allowed.has(String(pkg.pkgId)),
  );

  const candidates = input.packages
    .filter((pkg) => pkg.status === "ACTIVE" && allowed.has(String(pkg.pkgId)))
    .sort(
      (a, b) =>
        new Date(a.pkgStartDate).getTime() - new Date(b.pkgStartDate).getTime(),
    );

  if (candidates.length === 0) {
    // Check if member has matching packages in non-active or expired states
    if (matchingAll.length > 0) {
      const expired = matchingAll.find(
        (p) => p.status === "EXPIRED" || new Date(p.pkgEndDate) < now,
      );
      if (expired) {
        return {
          ok: false,
          code: "PACKAGE_EXPIRED",
          context: {
            packageName: expired.name,
            date: formatDateShort(expired.pkgEndDate),
          },
        };
      }

      const depleted = matchingAll.find(
        (p) => p.status === "COMPLETED" || Number(p.remainingClasses) <= 0,
      );
      if (depleted) {
        return {
          ok: false,
          code: "NO_REMAINING_SESSIONS",
          context: {
            packageName: depleted.name,
            remainingClasses: 0,
          },
        };
      }

      const future = matchingAll.find((p) => new Date(p.pkgStartDate) > now);
      if (future) {
        return {
          ok: false,
          code: "PACKAGE_NOT_YET_ACTIVE",
          context: {
            packageName: future.name,
            date: formatDateShort(future.pkgStartDate),
          },
        };
      }
    }

    const code = resolveBookingPackageFailure({
      hasAnyPackage: input.packages.length > 0,
      hasAnyActivePackage,
      matchingActiveCount: 0,
      skipReasons: [],
    });

    return {
      ok: false,
      code,
      context:
        code === "PACKAGE_DOES_NOT_OPEN_CLASS"
          ? { packageNames: activePackages.map((p) => p.name) }
          : undefined,
    };
  }

  const skipReasons: BookingPackageSkipReason[] = [];
  let lastSkippedPkg: EligibilityPackage | undefined;

  for (const pkg of candidates) {
    if (new Date(pkg.pkgStartDate) > now) {
      skipReasons.push("future");
      lastSkippedPkg = pkg;
      continue;
    }
    if (new Date(pkg.pkgEndDate) < now) {
      skipReasons.push("expired");
      lastSkippedPkg = pkg;
      continue;
    }
    if (Number(pkg.remainingClasses) <= 0) {
      skipReasons.push("remaining");
      lastSkippedPkg = pkg;
      continue;
    }
    if (input.cid && input.month && isRestricted(pkg, input.cid, input.month)) {
      skipReasons.push("restricted");
      lastSkippedPkg = pkg;
      continue;
    }
    return { ok: true, pkg };
  }

  const code = resolveBookingPackageFailure({
    hasAnyPackage: true,
    hasAnyActivePackage: true,
    matchingActiveCount: candidates.length,
    skipReasons,
  });

  return {
    ok: false,
    code,
    context: lastSkippedPkg
      ? {
          packageName: lastSkippedPkg.name,
          date:
            code === "PACKAGE_EXPIRED"
              ? formatDateShort(lastSkippedPkg.pkgEndDate)
              : code === "PACKAGE_NOT_YET_ACTIVE"
              ? formatDateShort(lastSkippedPkg.pkgStartDate)
              : undefined,
          remainingClasses: Number(lastSkippedPkg.remainingClasses),
        }
      : undefined,
  };
}
