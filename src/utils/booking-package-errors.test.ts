import {
  BOOKING_ERROR_MESSAGES,
  bookingPackageErrorMessage,
  quoteClassName,
  resolveBookingPackageFailure,
} from "./booking-package-errors";

describe("quoteClassName", () => {
  it("quotes a named class", () => {
    expect(quoteClassName("Mat Pilates 9 am")).toBe('"Mat Pilates 9 am"');
  });

  it("falls back when the class name is missing", () => {
    expect(quoteClassName("")).toBe("this class");
    expect(quoteClassName(undefined)).toBe("this class");
  });
});

describe("resolveBookingPackageFailure", () => {
  it("returns PACKAGE_DOES_NOT_OPEN_CLASS when the member has active packages that do not match", () => {
    expect(
      resolveBookingPackageFailure({
        hasAnyActivePackage: true,
        matchingActiveCount: 0,
        skipReasons: [],
      }),
    ).toBe("PACKAGE_DOES_NOT_OPEN_CLASS");
  });

  it("returns NO_ACTIVE_PACKAGE_FOUND when the member has no active packages", () => {
    expect(
      resolveBookingPackageFailure({
        hasAnyActivePackage: false,
        matchingActiveCount: 0,
        skipReasons: [],
      }),
    ).toBe("NO_ACTIVE_PACKAGE_FOUND");
  });

  it("prefers monthly restriction over remaining sessions and expiry", () => {
    expect(
      resolveBookingPackageFailure({
        hasAnyActivePackage: true,
        matchingActiveCount: 2,
        skipReasons: ["expired", "remaining", "restricted"],
      }),
    ).toBe("CLASS_RESTRICTION_REACHED");
  });

  it("prefers remaining sessions over expiry", () => {
    expect(
      resolveBookingPackageFailure({
        hasAnyActivePackage: true,
        matchingActiveCount: 2,
        skipReasons: ["expired", "remaining"],
      }),
    ).toBe("NO_REMAINING_SESSIONS");
  });

  it("returns PACKAGE_EXPIRED when matching packages only expired", () => {
    expect(
      resolveBookingPackageFailure({
        hasAnyActivePackage: true,
        matchingActiveCount: 1,
        skipReasons: ["expired"],
      }),
    ).toBe("PACKAGE_EXPIRED");
  });
});

describe("bookingPackageErrorMessage", () => {
  it("formats member-perspective messages with 'you / your' by default", () => {
    expect(
      bookingPackageErrorMessage("NO_PACKAGES_ON_ACCOUNT", "Mat Pilates"),
    ).toBe("You don't have any packages on your account. Please subscribe to a package before booking.");

    expect(
      bookingPackageErrorMessage(
        "PACKAGE_DOES_NOT_OPEN_CLASS",
        "Reformer Pilates",
        { packageNames: ["5 Studio"] },
      ),
    ).toBe('None of your active packages ("5 Studio") include "Reformer Pilates".');

    expect(
      bookingPackageErrorMessage("PACKAGE_EXPIRED", "Mat Pilates", {
        packageName: "10 Studio",
        date: "10 Aug 2026",
      }),
    ).toBe('Your package "10 Studio" covering "Mat Pilates" expired on 10 Aug 2026.');

    expect(
      bookingPackageErrorMessage("NO_REMAINING_SESSIONS", "Mat Pilates", {
        packageName: "10 Studio",
      }),
    ).toBe('Your package "10 Studio" covering "Mat Pilates" has 0 remaining sessions.');

    expect(
      bookingPackageErrorMessage("CLASS_RESTRICTION_REACHED", "Reformer Pilates", {
        packageName: "1 Month Ultimate Mindspacer",
        limit: 2,
      }),
    ).toBe('You have reached your monthly booking limit (2 sessions) for "Reformer Pilates" under package "1 Month Ultimate Mindspacer".');
  });

  it("formats admin-perspective messages with 'the member / this member'", () => {
    expect(
      bookingPackageErrorMessage("NO_PACKAGES_ON_ACCOUNT", "Mat Pilates", {
        audience: "admin",
      }),
    ).toBe("This member has no packages on their account. Please subscribe to a package before booking.");

    expect(
      bookingPackageErrorMessage(
        "PACKAGE_DOES_NOT_OPEN_CLASS",
        "Reformer Pilates",
        { packageNames: ["5 Studio"], audience: "admin" },
      ),
    ).toBe('None of the member\'s active packages ("5 Studio") include "Reformer Pilates".');

    expect(
      bookingPackageErrorMessage("PACKAGE_EXPIRED", "Mat Pilates", {
        packageName: "10 Studio",
        date: "10 Aug 2026",
        audience: "admin",
      }),
    ).toBe('The package "10 Studio" covering "Mat Pilates" expired on 10 Aug 2026.');
  });
});
