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

export type BookingAudience = "member" | "admin";

export const BOOKING_ERROR_MESSAGES = {
  NO_PACKAGES_ON_ACCOUNT: (className?: string, audience: BookingAudience = "member") =>
    audience === "member"
      ? `You don't have any packages on your account. Please subscribe to a package before booking.`
      : `This member has no packages on their account. Please subscribe to a package before booking.`,
  NO_ACTIVE_PACKAGE_FOUND: (className?: string, audience: BookingAudience = "member") =>
    audience === "member"
      ? `You have no active packages that can be used for ${quoteClassName(className)}.`
      : `No active package found for ${quoteClassName(className)}.`,
  PACKAGE_DOES_NOT_OPEN_CLASS: (
    className?: string,
    pkgNames?: string[],
    audience: BookingAudience = "member",
  ) => {
    if (audience === "member") {
      return pkgNames && pkgNames.length > 0
        ? `None of your active packages (${pkgNames.map((n) => `"${n}"`).join(", ")}) include ${quoteClassName(className)}.`
        : `None of your active packages include ${quoteClassName(className)}.`;
    }
    return pkgNames && pkgNames.length > 0
      ? `None of the member's active packages (${pkgNames.map((n) => `"${n}"`).join(", ")}) include ${quoteClassName(className)}.`
      : `No active package includes ${quoteClassName(className)}.`;
  },
  PACKAGE_EXPIRED: (
    className?: string,
    pkgName?: string,
    date?: string,
    audience: BookingAudience = "member",
  ) => {
    if (audience === "member") {
      return pkgName && date
        ? `Your package "${pkgName}" covering ${quoteClassName(className)} expired on ${date}.`
        : pkgName
        ? `Your package "${pkgName}" covering ${quoteClassName(className)} has expired.`
        : `Your package covering ${quoteClassName(className)} has expired.`;
    }
    return pkgName && date
      ? `The package "${pkgName}" covering ${quoteClassName(className)} expired on ${date}.`
      : pkgName
      ? `The package "${pkgName}" covering ${quoteClassName(className)} has expired.`
      : `The package that includes ${quoteClassName(className)} has expired.`;
  },
  NO_REMAINING_SESSIONS: (
    className?: string,
    pkgName?: string,
    audience: BookingAudience = "member",
  ) => {
    if (audience === "member") {
      return pkgName
        ? `Your package "${pkgName}" covering ${quoteClassName(className)} has 0 remaining sessions.`
        : `Your package covering ${quoteClassName(className)} has no remaining sessions.`;
    }
    return pkgName
      ? `The package "${pkgName}" covering ${quoteClassName(className)} has 0 remaining sessions.`
      : `The package that includes ${quoteClassName(className)} has no remaining sessions.`;
  },
  CLASS_RESTRICTION_REACHED: (
    className?: string,
    pkgName?: string,
    limit?: number,
    audience: BookingAudience = "member",
  ) => {
    if (audience === "member") {
      return pkgName && limit
        ? `You have reached your monthly booking limit (${limit} session${limit === 1 ? "" : "s"}) for ${quoteClassName(className)} under package "${pkgName}".`
        : pkgName
        ? `You have reached your monthly booking limit for ${quoteClassName(className)} under package "${pkgName}".`
        : `You have reached your monthly booking limit for ${quoteClassName(className)}.`;
    }
    return pkgName && limit
      ? `Monthly booking limit reached for ${quoteClassName(className)} under package "${pkgName}" (${limit} session${limit === 1 ? "" : "s"}/month).`
      : pkgName
      ? `Monthly booking limit reached for ${quoteClassName(className)} under package "${pkgName}".`
      : `Monthly booking limit reached for ${quoteClassName(className)}.`;
  },
  PACKAGE_NOT_YET_ACTIVE: (
    className?: string,
    pkgName?: string,
    date?: string,
    audience: BookingAudience = "member",
  ) => {
    if (audience === "member") {
      return pkgName && date
        ? `Your package "${pkgName}" covering ${quoteClassName(className)} starts on ${date} and is not active yet.`
        : `Your package covering ${quoteClassName(className)} is not active yet.`;
    }
    return pkgName && date
      ? `The package "${pkgName}" covering ${quoteClassName(className)} starts on ${date} and is not active yet.`
      : `The package that includes ${quoteClassName(className)} is not active yet.`;
  },
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
    audience?: BookingAudience;
  },
): string {
  const audience = extra?.audience ?? "member";
  switch (code) {
    case "NO_PACKAGES_ON_ACCOUNT":
      return BOOKING_ERROR_MESSAGES.NO_PACKAGES_ON_ACCOUNT(className, audience);
    case "PACKAGE_DOES_NOT_OPEN_CLASS":
      return BOOKING_ERROR_MESSAGES.PACKAGE_DOES_NOT_OPEN_CLASS(
        className,
        extra?.packageNames,
        audience,
      );
    case "PACKAGE_EXPIRED":
      return BOOKING_ERROR_MESSAGES.PACKAGE_EXPIRED(
        className,
        extra?.packageName,
        extra?.date,
        audience,
      );
    case "NO_REMAINING_SESSIONS":
      return BOOKING_ERROR_MESSAGES.NO_REMAINING_SESSIONS(
        className,
        extra?.packageName,
        audience,
      );
    case "CLASS_RESTRICTION_REACHED":
      return BOOKING_ERROR_MESSAGES.CLASS_RESTRICTION_REACHED(
        className,
        extra?.packageName,
        extra?.limit,
        audience,
      );
    case "PACKAGE_NOT_YET_ACTIVE":
      return BOOKING_ERROR_MESSAGES.PACKAGE_NOT_YET_ACTIVE(
        className,
        extra?.packageName,
        extra?.date,
        audience,
      );
    case "NO_CLASS_PACKAGES_CONFIGURED":
      return BOOKING_ERROR_MESSAGES.NO_CLASS_PACKAGES_CONFIGURED(className);
    case "NO_ACTIVE_PACKAGE_FOUND":
    default:
      return BOOKING_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND(className, audience);
  }
}
