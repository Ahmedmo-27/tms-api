import { Types } from "mongoose";
import { PaymentsService } from "./payments-service";
import Payment from "../models/payment";
import { ConflictError, NotFoundError, BadRequestError } from "../core/ApiError";

jest.mock("../models/payment");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock("./egygap-erp-service", () => ({
  refundPaymentToRentalSystem: jest.fn(),
}));

describe("PaymentsService.checkPayment multi-order / idempotency", () => {
  const mref = "scidXXXX";
  const amount = 450;

  beforeEach(() => {
    jest.clearAllMocks();
    (PaymentsService as any).geidea = {
      get: jest.fn(),
    };
  });

  it("returns first unused Success order when multiple Paid orders share a merchant ref", async () => {
    (PaymentsService as any).geidea.get.mockResolvedValue({
      data: {
        orders: [
          {
            orderId: "order-already-saved",
            currency: "EGP",
            totalAmount: 450,
            status: "Success",
          },
          {
            orderId: "order-new",
            currency: "EGP",
            totalAmount: 450,
            status: "Success",
          },
        ],
        totalCount: 2,
        totalAmount: 900,
      },
    });
    (Payment.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue([{ orderId: "order-already-saved" }]),
    });

    const orderId = await PaymentsService.checkPayment(mref, amount);
    expect(orderId).toBe("order-new");
  });

  it("throws PAYMENT_ALREADY_RECORDED when every Success order is already saved", async () => {
    (PaymentsService as any).geidea.get.mockResolvedValue({
      data: {
        orders: [
          {
            orderId: "order-1",
            currency: "EGP",
            totalAmount: 450,
            status: "Success",
          },
          {
            orderId: "order-2",
            currency: "EGP",
            totalAmount: 450,
            status: "Success",
          },
        ],
      },
    });
    (Payment.find as jest.Mock).mockReturnValue({
      select: jest
        .fn()
        .mockResolvedValue([
          { orderId: "order-1" },
          { orderId: "order-2" },
        ]),
    });

    await expect(PaymentsService.checkPayment(mref, amount)).rejects.toMatchObject({
      code: "PAYMENT_ALREADY_RECORDED",
    });
    await expect(PaymentsService.checkPayment(mref, amount)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("throws INVALID_PAYMENT when Geidea returns no orders", async () => {
    (PaymentsService as any).geidea.get.mockResolvedValue({
      data: { orders: [], totalCount: 0 },
    });

    await expect(PaymentsService.checkPayment(mref, amount)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws PAYMENT_FAILED when order is not Success", async () => {
    (PaymentsService as any).geidea.get.mockResolvedValue({
      data: {
        orders: [
          {
            orderId: "order-fail",
            currency: "EGP",
            totalAmount: 450,
            status: "Failed",
          },
        ],
      },
    });

    await expect(PaymentsService.checkPayment(mref, amount)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});

describe("PaymentsService.findPaymentByMerchantReference", () => {
  it("queries non-refunded payment by merchantReferenceId and purpose", async () => {
    const payment = { _id: new Types.ObjectId() };
    (Payment.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockResolvedValue(payment),
    });

    const result = await PaymentsService.findPaymentByMerchantReference(
      "mref-1",
      "DROPIN",
    );
    expect(Payment.findOne).toHaveBeenCalledWith({
      merchantReferenceId: "mref-1",
      isRefunded: { $ne: true },
      purpose: "DROPIN",
    });
    expect(result).toBe(payment);
  });
});
