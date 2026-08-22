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
  it("names the class when a package does not open it", () => {
    expect(
      bookingPackageErrorMessage(
        "PACKAGE_DOES_NOT_OPEN_CLASS",
        "Mat Pilates 9 am",
      ),
    ).toBe('No active package includes "Mat Pilates 9 am".');
  });

  it("keeps a true empty-package message generic", () => {
    expect(bookingPackageErrorMessage("NO_ACTIVE_PACKAGE_FOUND")).toBe(
      BOOKING_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND,
    );
  });
});
