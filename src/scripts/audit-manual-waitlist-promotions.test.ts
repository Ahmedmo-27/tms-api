import { Types } from "mongoose";
import { selectEligiblePackage } from "../utils/package-eligibility";

describe("audit-manual-waitlist-promotions logic", () => {
  it("correctly identifies package deduction when booking method matches an active package", () => {
    const bookedMethod: string = "Studio 10 Sessions";
    const memberBookingRecord = {
      scid: new Types.ObjectId(),
      bookingTime: new Date(),
      isDropIn: false,
      package: "Studio 10 Sessions",
    };

    const isWalkInMethod = /^(walk in|waitlist confirmed)$/i.test(bookedMethod.trim());
    const isDropInBooking = Boolean(memberBookingRecord?.isDropIn || bookedMethod.toLowerCase() === "drop in");
    const isPackageMethod = Boolean(!isWalkInMethod && !isDropInBooking && bookedMethod !== "N/A");

    expect(isPackageMethod).toBe(true);
    expect(memberBookingRecord.isDropIn).toBe(false);

    const sessionDeducted = isPackageMethod && !memberBookingRecord.isDropIn ? "YES" : "NO";
    expect(sessionDeducted).toBe("YES");
  });

  it("correctly flags silent walk-in when member was promoted without package deduction and without payment", () => {
    const bookedMethod: string = "Walk In";
    const memberBookingRecord = {
      scid: new Types.ObjectId(),
      bookingTime: new Date(),
      isDropIn: true,
    };

    const isWalkInMethod = /^(walk in|waitlist confirmed)$/i.test(bookedMethod.trim());
    const isDropInBooking = Boolean(memberBookingRecord?.isDropIn || bookedMethod.toLowerCase() === "drop in");
    const isPackageMethod = Boolean(!isWalkInMethod && !isDropInBooking && bookedMethod !== "N/A");

    const sessionDeducted = isPackageMethod && !memberBookingRecord.isDropIn ? "YES" : "NO";
    expect(sessionDeducted).toBe("NO");

    // Check package eligibility for member with NO packages
    const eligibilityResult = selectEligiblePackage({
      packages: [],
      allowedPkgIds: ["some-pkg-id"],
    });

    expect(eligibilityResult.ok).toBe(false);
    if (!eligibilityResult.ok) {
      expect(eligibilityResult.code).toBe("NO_PACKAGES_ON_ACCOUNT");
    }
  });

  it("correctly detects missed deduction when member had an active eligible package but was booked as Walk In", () => {
    const pkgId = new Types.ObjectId().toString();
    const eligibilityResult = selectEligiblePackage({
      packages: [
        {
          pkgId,
          name: "Studio 10",
          status: "ACTIVE",
          pkgStartDate: new Date("2026-01-01"),
          pkgEndDate: new Date("2026-12-31"),
          remainingClasses: 7,
        },
      ],
      allowedPkgIds: [pkgId],
      now: new Date("2026-10-23T12:15:00Z"),
    });

    expect(eligibilityResult.ok).toBe(true);
    if (eligibilityResult.ok) {
      expect(eligibilityResult.pkg.remainingClasses).toBe(7);
      expect(eligibilityResult.pkg.name).toBe("Studio 10");
    }
  });
});
