import { resolvePtPaymentPurposeLabel } from "./pt-payment-purpose";

describe("resolvePtPaymentPurposeLabel", () => {
  it("resolves PT drop-in note with coach name", () => {
    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "PT dropin with Salma Ghazzawi",
      }),
    ).toBe("PT dropin with Salma Ghazzawi");
  });

  it("resolves PT drop-in note with custom admin addition", () => {
    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "PT dropin with Coach Ahmed; 20% discount applied",
      }),
    ).toBe("PT dropin with Coach Ahmed");
  });

  it("resolves legacy personal training drop-in note format", () => {
    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "Personal training drop-in with Captain Ziad",
      }),
    ).toBe("PT dropin with Captain Ziad");

    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "Personal training guest drop-in with Captain Ziad",
      }),
    ).toBe("PT dropin with Captain Ziad");
  });

  it("resolves standalone PT drop-in note without coach", () => {
    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "PT dropin",
      }),
    ).toBe("PT dropin");
  });

  it("returns null for non-PT payments", () => {
    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "DROPIN",
        note: "Open Gym drop-in",
      }),
    ).toBeNull();

    expect(
      resolvePtPaymentPurposeLabel({
        purpose: "PACKAGE",
      }),
    ).toBeNull();
  });
});
