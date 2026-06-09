import { Types } from "mongoose";
import { IRefund } from "../models/refund";

describe("buildRefundErpPayload", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      ENVIRONMENT: "testing",
      RENTAL_STORE_ID: "store-1",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns negative amounts for member refunds", () => {
    const { buildRefundErpPayload } = require("./egygap-erp-service");

    const refund = {
      _id: new Types.ObjectId("507f1f77bcf86cd799439011"),
      type: "REFUND",
      amount: 250,
      reason: "Customer request",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    } as IRefund;

    expect(buildRefundErpPayload(refund)).toEqual({
      store: "store-1",
      invoice_date: "2026-06-10",
      invoice_amount: -250,
      net_amount: -250,
      external_id: "store-1-refund-507f1f77bcf86cd799439011",
      external_reference: "refund-507f1f77bcf86cd799439011",
      external_type: 0,
      external_type_name: "Member Refund: Customer request",
    });
  });

  it("returns negative amounts for cash outs", () => {
    const { buildRefundErpPayload } = require("./egygap-erp-service");

    const refund = {
      _id: new Types.ObjectId("507f1f77bcf86cd799439012"),
      type: "CASHOUT",
      amount: 500,
      createdAt: new Date("2026-06-10T15:30:00.000Z"),
    } as IRefund;

    expect(buildRefundErpPayload(refund)).toEqual({
      store: "store-1",
      invoice_date: "2026-06-10",
      invoice_amount: -500,
      net_amount: -500,
      external_id: "store-1-cashout-507f1f77bcf86cd799439012",
      external_reference: "cashout-507f1f77bcf86cd799439012",
      external_type: 0,
      external_type_name: "Cash Out",
    });
  });
});

describe("buildPaymentRefundErpPayload", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      ENVIRONMENT: "testing",
      RENTAL_STORE_ID: "store-1",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns negative amounts for automated payment refunds", () => {
    const { buildPaymentRefundErpPayload } = require("./egygap-erp-service");

    const payment = {
      _id: new Types.ObjectId("507f1f77bcf86cd799439099"),
      amount: 350,
      refundReason: "Drop-in cancellation: Mat Pilates",
    };

    const payload = buildPaymentRefundErpPayload(payment);

    expect(payload.invoice_amount).toBe(-350);
    expect(payload.net_amount).toBe(-350);
    expect(payload.external_id).toBe(
      "store-1-refund-507f1f77bcf86cd799439099"
    );
    expect(payload.external_reference).toBe(
      "refund-507f1f77bcf86cd799439099"
    );
    expect(payload.external_type_name).toBe(
      "Payment Refund: Drop-in cancellation: Mat Pilates"
    );
  });

  it("supports partial refund amounts when provided", () => {
    const { buildPaymentRefundErpPayload } = require("./egygap-erp-service");

    const payment = {
      _id: new Types.ObjectId("507f1f77bcf86cd799439099"),
      amount: 350,
      refundReason: "Partial refund",
    };

    const payload = buildPaymentRefundErpPayload(payment, 100);

    expect(payload.invoice_amount).toBe(-100);
    expect(payload.net_amount).toBe(-100);
  });
});
