import {
  getDefaultAllowedFreezeDays,
  resolvePackageAllowedFreezeDays,
} from "../models/package";
import {
  bookingPackageErrorMessage,
} from "../utils/booking-package-errors";
import { selectEligiblePackage } from "../utils/package-eligibility";

describe("Freeze Feature - Comprehensive Edge Cases", () => {
  describe("1. Freeze Quota Calculations across Tiers", () => {
    it("assigns 7 days freeze for 1 month package (25-45 days)", () => {
      expect(getDefaultAllowedFreezeDays(30)).toBe(7);
      expect(getDefaultAllowedFreezeDays(28)).toBe(7);
    });

    it("assigns 14 days freeze for 3 months package (75-105 days)", () => {
      expect(getDefaultAllowedFreezeDays(90)).toBe(14);
    });

    it("assigns 21 days freeze for 6 months package (160-200 days)", () => {
      expect(getDefaultAllowedFreezeDays(180)).toBe(21);
    });

    it("assigns 42 days freeze for 1 year package (340+ days)", () => {
      expect(getDefaultAllowedFreezeDays(365)).toBe(42);
      expect(getDefaultAllowedFreezeDays(360)).toBe(42);
    });

    it("assigns 0 days freeze for short-term passes or drop-ins (< 25 days)", () => {
      expect(getDefaultAllowedFreezeDays(1)).toBe(0);
      expect(getDefaultAllowedFreezeDays(7)).toBe(0);
      expect(getDefaultAllowedFreezeDays(10)).toBe(0);
      expect(getDefaultAllowedFreezeDays(20)).toBe(0);
    });

    it("allows custom admin override for allowedFreezeDays on catalog package", () => {
      expect(
        resolvePackageAllowedFreezeDays({
          expiryPeriod: 30,
          allowedFreezeDays: 10,
        })
      ).toBe(10);
    });
  });

  describe("2. Multi-Package Eligibility Edge Cases", () => {
    it("skips frozen package and uses secondary active package if available", () => {
      const result = selectEligiblePackage({
        packages: [
          {
            pkgId: "pkg-frozen",
            name: "Frozen 3 Month Package",
            status: "FROZEN",
            pkgStartDate: new Date("2026-08-01"),
            pkgEndDate: new Date("2026-11-01"),
            remainingClasses: 20,
          },
          {
            pkgId: "pkg-active",
            name: "Active 10 Class Pass",
            status: "ACTIVE",
            pkgStartDate: new Date("2026-08-15"),
            pkgEndDate: new Date("2026-10-15"),
            remainingClasses: 5,
          },
        ],
        allowedPkgIds: ["pkg-frozen", "pkg-active"],
        now: new Date("2026-09-01"),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pkg.pkgId).toBe("pkg-active");
        expect(result.pkg.name).toBe("Active 10 Class Pass");
      }
    });

    it("returns PACKAGE_FROZEN when all matching packages are frozen", () => {
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

    it("prioritizes PACKAGE_EXPIRED if package is both expired and not active", () => {
      const result = selectEligiblePackage({
        packages: [
          {
            pkgId: "pkg-expired",
            name: "Expired 1 Month",
            status: "EXPIRED",
            pkgStartDate: new Date("2026-06-01"),
            pkgEndDate: new Date("2026-07-01"),
            remainingClasses: 10,
          },
        ],
        allowedPkgIds: ["pkg-expired"],
        now: new Date("2026-09-01"),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PACKAGE_EXPIRED");
      }
    });
  });

  describe("3. Error Messaging for Different Audiences", () => {
    it("provides member-friendly error message with unfreeze date", () => {
      const msg = bookingPackageErrorMessage("PACKAGE_FROZEN", "Functional Training", {
        packageName: "3 Months Space",
        date: "15 Sep 2026",
        audience: "member",
      });
      expect(msg).toContain('Your package "3 Months Space" is currently frozen until 15 Sep 2026');
      expect(msg).toContain('You cannot book "Functional Training" while it is frozen.');
    });

    it("provides admin-friendly error message with clarity for front desk", () => {
      const msg = bookingPackageErrorMessage("PACKAGE_FROZEN", "Functional Training", {
        packageName: "3 Months Space",
        date: "15 Sep 2026",
        audience: "admin",
      });
      expect(msg).toContain('The package "3 Months Space" is frozen until 15 Sep 2026');
      expect(msg).toContain('cannot be used for "Functional Training"');
    });

    it("falls back gracefully when date is omitted", () => {
      const msg = bookingPackageErrorMessage("PACKAGE_FROZEN", "Pilates Reformer", {
        packageName: "Ultimate Mindspacer",
        audience: "member",
      });
      expect(msg).toContain('Your package "Ultimate Mindspacer" is currently frozen');
    });
  });
});
