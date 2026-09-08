import {
  getDefaultAllowedFreezeDays,
  resolvePackageAllowedFreezeDays,
} from "../models/package";
import {
  BOOKING_ERROR_MESSAGES,
  bookingPackageErrorMessage,
} from "../utils/booking-package-errors";
import { selectEligiblePackage } from "../utils/package-eligibility";

describe("Package Freeze Calculation", () => {
  it("calculates correct default freeze durations according to package duration", () => {
    // 1 Month -> 1 Week (7 days)
    expect(getDefaultAllowedFreezeDays(30)).toBe(7);
    // 3 Months -> 2 Weeks (14 days)
    expect(getDefaultAllowedFreezeDays(90)).toBe(14);
    // 6 Months -> 3 Weeks (21 days)
    expect(getDefaultAllowedFreezeDays(180)).toBe(21);
    // 1 Year -> 6 Weeks (42 days)
    expect(getDefaultAllowedFreezeDays(365)).toBe(42);
    // Short package (< 25 days) -> 0 days
    expect(getDefaultAllowedFreezeDays(10)).toBe(0);
  });

  it("respects custom allowedFreezeDays when specified on package", () => {
    expect(
      resolvePackageAllowedFreezeDays({
        expiryPeriod: 30,
        allowedFreezeDays: 10,
      })
    ).toBe(10);

    expect(
      resolvePackageAllowedFreezeDays({
        expiryPeriod: 90,
      })
    ).toBe(14);
  });
});

describe("Booking Error Handling for Frozen Packages", () => {
  it("formats PACKAGE_FROZEN error message correctly for members and admins", () => {
    const memberMsg = bookingPackageErrorMessage("PACKAGE_FROZEN", "Yoga Flow", {
      packageName: "6 Months Space",
      date: "25 Sep 2026",
      audience: "member",
    });
    expect(memberMsg).toContain('Your package "6 Months Space" is currently frozen until 25 Sep 2026');

    const adminMsg = bookingPackageErrorMessage("PACKAGE_FROZEN", "Yoga Flow", {
      packageName: "6 Months Space",
      date: "25 Sep 2026",
      audience: "admin",
    });
    expect(adminMsg).toContain('The package "6 Months Space" is frozen until 25 Sep 2026');
  });

  it("selectEligiblePackage detects frozen package and returns PACKAGE_FROZEN", () => {
    const result = selectEligiblePackage({
      packages: [
        {
          pkgId: "pkg-1",
          name: "1 Month Space",
          status: "FROZEN",
          pkgStartDate: new Date("2026-08-01"),
          pkgEndDate: new Date("2026-09-15"),
          remainingClasses: 10,
        },
      ],
      allowedPkgIds: ["pkg-1"],
      now: new Date("2026-09-01"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PACKAGE_FROZEN");
      expect(result.context?.packageName).toBe("1 Month Space");
    }
  });
});
