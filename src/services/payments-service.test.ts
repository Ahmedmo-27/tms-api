import { PaymentsService } from "./payments-service";
import Payment from "../models/payment";
import * as egygapService from "./egygap-erp-service";

jest.mock("../models/payment");
jest.mock("./egygap-erp-service");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("PaymentsService.refundPayment", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should update payment and call refundPaymentToRentalSystem", async () => {
    const mockSession = {} as any;
    const mockPaymentResult = {
      _id: "some-payment-id",
      amount: 1500,
      isRefunded: true,
      refundReason: "Customer request",
    };

    (Payment.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockPaymentResult);

    await PaymentsService.refundPayment("some-payment-id", mockSession, "Customer request");

    expect(Payment.findByIdAndUpdate).toHaveBeenCalledWith(
      "some-payment-id",
      {
        $set: {
          isRefunded: true,
          refundReason: "Customer request",
        },
      },
      { new: true, session: mockSession }
    );

    expect(egygapService.refundPaymentToRentalSystem).toHaveBeenCalledWith(mockPaymentResult);
  });

  it("should not block refund if refundPaymentToRentalSystem fails", async () => {
    const mockSession = {} as any;
    const mockPaymentResult = {
      _id: "some-payment-id",
      amount: 1500,
      isRefunded: true,
    };

    (Payment.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockPaymentResult);
    (egygapService.refundPaymentToRentalSystem as jest.Mock).mockRejectedValue(new Error("ERP Error"));

    await expect(PaymentsService.refundPayment("some-payment-id", mockSession)).resolves.not.toThrow();

    expect(Payment.findByIdAndUpdate).toHaveBeenCalled();
    expect(egygapService.refundPaymentToRentalSystem).toHaveBeenCalled();
  });
});
