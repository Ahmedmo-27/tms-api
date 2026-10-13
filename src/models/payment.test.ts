import Payment from "./payment";
import { Types } from "mongoose";

describe("Payment Model Schema", () => {
  it("does not default platform to COACHERA", () => {
    const payment = new Payment({
      amount: 4000,
      paymentMethod: "VISA",
      paymentTime: new Date(),
      purpose: "NON_USER_PACKAGE",
      nonMemberName: "Nour Bahaa",
      nonMemberPhone: "01282866350",
      pkgId: new Types.ObjectId(),
    });

    expect(payment.platform).toBeUndefined();
  });

  it("allows setting platform explicitly when required (e.g. Coachera integration)", () => {
    const payment = new Payment({
      amount: 2500,
      paymentMethod: "COACHERA",
      paymentTime: new Date(),
      purpose: "ONLINE_CLASS",
      platform: "COACHERA",
    });

    expect(payment.platform).toBe("COACHERA");
  });
});
