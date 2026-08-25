import {
  matchSpaceRowForPayment,
  spacePaymentPurpose,
  spacePhonesMatch,
} from "./sheet-space-payments";

describe("spacePaymentPurpose", () => {
  it("labels a drop-in payment as Drop in Space even without a package", () => {
    expect(
      spacePaymentPurpose({ purpose: "DROPIN", note: "Open gym drop-in" }),
    ).toBe("Drop in Space");
    expect(spacePaymentPurpose({ purpose: "DROPIN" })).toBe("Drop in Space");
    expect(spacePaymentPurpose({ purpose: "WALKIN" })).toBe("Drop in Space");
    expect(
      spacePaymentPurpose({ purpose: "DROPIN", scid: "60f7b1b3b3b3b3b3b3b3b3b3" }),
    ).toBe("Drop in");
  });

  it("prefers the catalog package name when one is attached", () => {
    expect(
      spacePaymentPurpose({
        purpose: "PACKAGE",
        pkgId: { name: "1 Month Space" },
      }),
    ).toBe("1 Month Space");
  });
});

describe("matchSpaceRowForPayment", () => {
  const rows = [
    {
      name: "Joumana Taha",
      phone: "01270443033",
      amount: null as number | null,
    },
    {
      memberId: "abc",
      name: "Member One",
      phone: "01000000000",
      amount: null as number | null,
    },
  ];

  it("matches a guest drop-in by phone when there is no member id", () => {
    expect(
      matchSpaceRowForPayment(rows, {
        name: "Joumana Taha",
        phone: "1270443033",
      })?.name,
    ).toBe("Joumana Taha");
  });

  it("matches a guest drop-in by name when the phone is missing", () => {
    expect(
      matchSpaceRowForPayment(rows, {
        name: "joumana  taha",
        phone: "",
      })?.name,
    ).toBe("Joumana Taha");
  });

  it("does not steal a payment already filled on another row", () => {
    const filled = [{ ...rows[0], amount: 785 }, rows[1]];
    expect(
      matchSpaceRowForPayment(filled, {
        name: "Joumana Taha",
        phone: "01270443033",
      }),
    ).toBeUndefined();
  });
});

describe("spacePhonesMatch", () => {
  it("treats a leading zero as the same number", () => {
    expect(spacePhonesMatch("01270443033", "1270443033")).toBe(true);
  });
});
