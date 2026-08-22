export type BookingPackageSkipReason = "expired" | "remaining" | "restricted" | "future";

export type BookingPackageFailureCode =
  | "NO_PACKAGES_ON_ACCOUNT"
  | "NO_ACTIVE_PACKAGE_FOUND"
  | "PACKAGE_DOES_NOT_OPEN_CLASS"
  | "PACKAGE_EXPIRED"
  | "NO_REMAINING_SESSIONS"
  | "CLASS_RESTRICTION_REACHED"
  | "PACKAGE_NOT_YET_ACTIVE"
  | "NO_CLASS_PACKAGES_CONFIGURED";

export function quoteClassName(className?: string): string {
  const name = (className || "").trim();
  return name ? `"${name}"` : "this class";
}

export function formatDateShort(date?: Date | string): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function resolveBookingPackageFailure(input: {
  hasAnyPackage?: boolean;
  hasAnyActivePackage?: boolean;
  matchingActiveCount?: number;
  skipReasons?: BookingPackageSkipReason[];
}): BookingPackageFailureCode {
  if (input.hasAnyPackage === false) {
    return "NO_PACKAGES_ON_ACCOUNT";
  }

  const matchingCount = input.matchingActiveCount ?? 0;
  if (matchingCount <= 0) {
    return input.hasAnyActivePackage
      ? "PACKAGE_DOES_NOT_OPEN_CLASS"
      : "NO_ACTIVE_PACKAGE_FOUND";
  }

  const reasons = input.skipReasons ?? [];
  if (reasons.includes("restricted")) {
    return "CLASS_RESTRICTION_REACHED";
  }
  if (reasons.includes("remaining")) {
    return "NO_REMAINING_SESSIONS";
  }
  if (reasons.includes("expired")) {
    return "PACKAGE_EXPIRED";
  }
  if (reasons.includes("future")) {
    return "PACKAGE_NOT_YET_ACTIVE";
  }

  return "NO_ACTIVE_PACKAGE_FOUND";
}

export const BOOKING_ERROR_MESSAGES = {
  NO_PACKAGES_ON_ACCOUNT: (className?: string) =>
    `No packages found on this account. A package covering ${quoteClassName(className)} is required to book.`,
  NO_ACTIVE_PACKAGE_FOUND: "No active package found.",
  PACKAGE_DOES_NOT_OPEN_CLASS: (className?: string, pkgNames?: string[]) =>
    pkgNames && pkgNames.length > 0
      ? `None of the member's active packages (${pkgNames.map((n) => `"${n}"`).join(", ")}) include ${quoteClassName(className)}.`
      : `No active package includes ${quoteClassName(className)}.`,
  PACKAGE_EXPIRED: (className?: string, pkgName?: string, date?: string) =>
    pkgName && date
      ? `The package "${pkgName}" covering ${quoteClassName(className)} expired on ${date}.`
      : pkgName
      ? `The package "${pkgName}" covering ${quoteClassName(className)} has expired.`
      : `The package that includes ${quoteClassName(className)} has expired.`,
  NO_REMAINING_SESSIONS: (className?: string, pkgName?: string) =>
    pkgName
      ? `The package "${pkgName}" covering ${quoteClassName(className)} has 0 remaining sessions.`
      : `The package that includes ${quoteClassName(className)} has no remaining sessions.`,
  CLASS_RESTRICTION_REACHED: (className?: string, pkgName?: string, limit?: number) =>
    pkgName && limit
      ? `The monthly limit (${limit} session${limit === 1 ? "" : "s"}) for ${quoteClassName(className)} on "${pkgName}" has been reached.`
      : pkgName
      ? `The monthly limit for ${quoteClassName(className)} on "${pkgName}" has been reached.`
      : `The monthly limit for ${quoteClassName(className)} has been reached.`,
  PACKAGE_NOT_YET_ACTIVE: (className?: string, pkgName?: string, date?: string) =>
    pkgName && date
      ? `The package "${pkgName}" covering ${quoteClassName(className)} starts on ${date} and is not active yet.`
      : `The package that includes ${quoteClassName(className)} is not active yet.`,
  NO_CLASS_PACKAGES_CONFIGURED: (className?: string) =>
    `No packages in the catalog open ${quoteClassName(className)} at this branch.`,
} as const;

export function bookingPackageErrorMessage(
  code: BookingPackageFailureCode,
  className?: string,
  extra?: {
    packageName?: string;
    packageNames?: string[];
    date?: string;
    limit?: number;
  },
): string {
  switch (code) {
    case "NO_PACKAGES_ON_ACCOUNT":
      return BOOKING_ERROR_MESSAGES.NO_PACKAGES_ON_ACCOUNT(className);
    case "PACKAGE_DOES_NOT_OPEN_CLASS":
      return BOOKING_ERROR_MESSAGES.PACKAGE_DOES_NOT_OPEN_CLASS(
        className,
        extra?.packageNames,
      );
    case "PACKAGE_EXPIRED":
      return BOOKING_ERROR_MESSAGES.PACKAGE_EXPIRED(
        className,
        extra?.packageName,
        extra?.date,
      );
    case "NO_REMAINING_SESSIONS":
      return BOOKING_ERROR_MESSAGES.NO_REMAINING_SESSIONS(
        className,
        extra?.packageName,
      );
    case "CLASS_RESTRICTION_REACHED":
      return BOOKING_ERROR_MESSAGES.CLASS_RESTRICTION_REACHED(
        className,
        extra?.packageName,
        extra?.limit,
      );
    case "PACKAGE_NOT_YET_ACTIVE":
      return BOOKING_ERROR_MESSAGES.PACKAGE_NOT_YET_ACTIVE(
        className,
        extra?.packageName,
        extra?.date,
      );
    case "NO_CLASS_PACKAGES_CONFIGURED":
      return BOOKING_ERROR_MESSAGES.NO_CLASS_PACKAGES_CONFIGURED(className);
    case "NO_ACTIVE_PACKAGE_FOUND":
    default:
      return BOOKING_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND;
  }
}
