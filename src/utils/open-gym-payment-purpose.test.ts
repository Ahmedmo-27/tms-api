import {
  formatOpenGymDurationLabel,
  resolveOpenGymPaymentNote,
  resolveOpenGymPaymentPurposeLabel,
} from "./open-gym-payment-purpose";

describe("formatOpenGymDurationLabel", () => {
  it("formats custom week and month durations", () => {
    expect(formatOpenGymDurationLabel(21)).toBe("3 weeks");
    expect(formatOpenGymDurationLabel(60)).toBe("2 months");
    expect(formatOpenGymDurationLabel(45)).toBe("45 days");
  });
});

describe("resolveOpenGymPaymentNote", () => {
  it("prefers the package name when provided", () => {
    expect(
      resolveOpenGymPaymentNote(
        "OPEN_GYM",
        undefined,
        "Premium 2-Month Pass",
        60,
      ),
    ).toBe("Premium 2-Month Pass");
  });

  it("falls back to duration labels", () => {
    expect(resolveOpenGymPaymentNote("OPEN_GYM", undefined, undefined, 21)).toBe(
      "Open gym 3 weeks package",
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
          name: "Open Gym 2 Weeks — Maadi",
          expiryPeriod: 14,
        },
      }),
    ).toBe("Open Gym 2 Weeks — Maadi");
  });
});
