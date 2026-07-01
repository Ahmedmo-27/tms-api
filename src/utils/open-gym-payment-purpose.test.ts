import {
  resolveOpenGymPaymentNote,
  resolveOpenGymPaymentPurposeLabel,
} from "./open-gym-payment-purpose";

describe("resolveOpenGymPaymentNote", () => {
  it("prefers the package name when provided", () => {
    expect(
      resolveOpenGymPaymentNote("OPEN_GYM", "BIMONTHLY", "Premium 2-Month Pass"),
    ).toBe("Premium 2-Month Pass");
  });

  it("falls back to renewal period labels", () => {
    expect(resolveOpenGymPaymentNote("OPEN_GYM", "TRIWEEKLY")).toBe(
      "Open gym 3-week package",
    );
    expect(resolveOpenGymPaymentNote("OPEN_GYM", "TRIMONTHLY")).toBe(
      "Open gym 3-month package",
    );
  });
});

describe("resolveOpenGymPaymentPurposeLabel", () => {
  it("uses package name for open gym subscriptions", () => {
    expect(
      resolveOpenGymPaymentPurposeLabel({
        purpose: "PACKAGE",
        pkgId: {
          category: "OPEN_GYM",
          renewalPeriod: "BIWEEKLY",
          name: "Open Gym 2 Weeks — Maadi",
        },
      }),
    ).toBe("Open Gym 2 Weeks — Maadi");
  });
});
