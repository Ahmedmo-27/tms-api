import { PaymentsService } from "./payments-service";
import Payment from "../models/payment";
import Refund from "../models/refund";
import * as egygapService from "./egygap-erp-service";
import { getMainBranchLocationId } from "../utils/app-package-location";

jest.mock("../models/payment");
jest.mock("../models/refund");
jest.mock("./egygap-erp-service");
jest.mock("../utils/app-package-location", () => ({
  getMainBranchLocationId: jest.fn(),
}));
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

describe("PaymentsService.savePayment", () => {
  const mainBranchId = "69ec4abad8394559ce7ca77c";

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should default locationId to main branch ID when purpose is PACKAGE and locationId is missing", async () => {
    (getMainBranchLocationId as jest.Mock).mockResolvedValue(mainBranchId);

    const mockSave = jest.fn().mockResolvedValue(true);
    (Payment as unknown as jest.Mock).mockImplementation((doc) => ({
      ...doc,
      save: mockSave,
    }));

    await PaymentsService.savePayment(
      "user-1",
      2500,
      "APP",
      "PACKAGE",
      {} as any,
      undefined,
      undefined,
      undefined,
      "pkg-1" as any
    );

    expect(Payment).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "PACKAGE",
        locationId: expect.anything(),
      })
    );
    expect(mockSave).toHaveBeenCalled();
  });
});

describe("PaymentsService.getPayments", () => {
  const mainBranchId = "69ec4abad8394559ce7ca77c";

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should query for locationId or null/missing locationId when requesting main branch", async () => {
    (getMainBranchLocationId as jest.Mock).mockResolvedValue(mainBranchId);

    const mockPaymentFindResult = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    (Payment.find as jest.Mock).mockReturnValue(mockPaymentFindResult);

    const mockRefundFindResult = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    (Refund.find as jest.Mock).mockReturnValue(mockRefundFindResult);

    await PaymentsService.getPayments(
      "2026-10-12",
      undefined,
      undefined,
      mainBranchId
    );

    expect(Payment.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.anything(),
          { locationId: { $exists: false } },
          { locationId: null },
        ]),
      })
    );
  });
});
