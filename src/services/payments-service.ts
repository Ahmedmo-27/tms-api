import Payment from "../models/payment";
import { ClientSession, Types } from "mongoose";
import axios from "axios";
import { BadRequestError, NotFoundError } from "../core/ApiError";
import { IPayment } from "../models/payment";
import logger from "../config/logger";
import { refundPaymentToRentalSystem } from "./egygap-erp-service";

export class PaymentsService {
  static token = Buffer.from(
    `${process.env.GEIDEA_MERCHANT_KEY}:${process.env.GEIDEA_API_PASSWORD}`
  ).toString("base64");
  static geidea = axios.create({
    baseURL: process.env.GEIDEA_URL,
    withCredentials: true,
    headers: {
      Authorization: `Basic ${this.token}`,
      "Content-Type": "application/json",
    },
  });

  static async getPayments(
    dateString?: string,
    month?: number,
    year?: number
  ): Promise<IPayment[]> {
    const query: Record<string, any> = {};

    const currentYear = new Date().getUTCFullYear();
    const targetYear = year || currentYear;

    if (dateString && dateString !== "") {
      const date = new Date(dateString);
      const startOfDay = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          0,
          0,
          0
        )
      );

      const endOfDay = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() + 1,
          0,
          0,
          0
        )
      );
      query.paymentTime = {
        $gte: startOfDay,
        $lt: endOfDay,
      };
    } else if (month) {
      const m = month - 1;
      const start = new Date(Date.UTC(targetYear, m, 1));
      const end = new Date(Date.UTC(targetYear, m + 1, 1));
      query.paymentTime = { $gte: start, $lt: end };
    }
    const payments = await Payment.find(query)
      .populate("uid")
      .populate({
        path: "scid",
        populate: { path: "cid", populate: { path: "locations" } },
      })
      .populate("pkgId");
    return payments;
  }

  static async getExposedPayments(
    dateString?: string,
    month?: number,
    year?: number
  ): Promise<any> {
    const query: Record<string, any> = {};

    const currentYear = new Date().getUTCFullYear();
    const targetYear = year || currentYear;

    if (dateString && dateString !== "") {
      const date = new Date(dateString);
      const startOfDay = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          0,
          0,
          0
        )
      );

      const endOfDay = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() + 1,
          0,
          0,
          0
        )
      );
      query.paymentTime = {
        $gte: startOfDay,
        $lt: endOfDay,
      };
    } else if (month) {
      const m = month - 1;
      const start = new Date(Date.UTC(targetYear, m, 1));
      const end = new Date(Date.UTC(targetYear, m + 1, 1));
      query.paymentTime = { $gte: start, $lt: end };
    }

    // Fetch all payments with populated package data
    const allPayments = await Payment.find(query)
      .populate("pkgId")
      .select("purpose amount paymentMethod paymentTime isRefunded");

    // Filter out payments where package name contains "PT"
    const filteredPayments = allPayments.filter(payment => {
      // If there's no package associated, include the payment
      if (!payment.pkgId) {
        return true;
      }

      // remove deducted from package payments
      if(payment.paymentMethod === "DEDUCTED") return false

      // If package exists, check if name contains "PT" (case insensitive)
      const packageName = (payment.pkgId as any).name;
      if (packageName && typeof packageName === 'string') {
        return !packageName.toUpperCase().includes('PT');
      }

      // If package name is not available, include the payment
      return true;
    });

    // Remove the populated pkgId data from the final payments
    const finalPayments = filteredPayments.map(payment => {
      const { pkgId, ...paymentWithoutPkg } = payment.toObject();
      return paymentWithoutPkg;
    });
    let total = 0;
    filteredPayments.forEach((payment) => total = total + payment.amount)
    return {payments: finalPayments, total};
  }

  static async checkPayment(
    merchantReferenceId: string,
    amount: number
  ): Promise<string> {
    const response = await this.geidea.get(
      `/order?MerchantReferenceId=${merchantReferenceId}`
    );
    logger.info(`Geidea response for reference ${merchantReferenceId}:`, response.data);
    const order = response.data.orders[0];
    if (!order) throw new NotFoundError("INVALID_PAYMENT", "Payment not found");
    if (order.currency && order.currency !== "EGP")
      throw new BadRequestError(
        "UNSUPPORTED_CURRENCY",
        "All payments should be in egyptian pounds"
      );
    if (order.totalAmount !== amount)
      throw new BadRequestError(
        "INVALID_PAYMENT_AMOUNT",
        "Payment amount doesn't match required amount"
      );
    if (order.status !== "Success")
      throw new BadRequestError("PAYMENT_FAILED", "Payment is not completed");
    return order.orderId;
  }

  static async savePayment(
    uid: string | undefined,
    amount: number,
    paymentMethod: string,
    purpose: string,
    session: ClientSession,
    orderId?: string,
    merchantReferenceId?: string,
    scid?: Types.ObjectId,
    pkgId?: Types.ObjectId,
    paymentDate?: string,
    note?: string,
    nonMemberName?: string,
    nonMemberPhone?: string
  ): Promise<IPayment> {
    const payment = new Payment({
      uid,
      amount,
      paymentMethod,
      paymentTime: paymentDate ? new Date(paymentDate) : new Date(),
      purpose,
      orderId,
      merchantReferenceId,
      scid,
      pkgId,
      note,
      isRefunded: false,
      nonMemberName,
      nonMemberPhone,
    });
    await payment.save({ session });
    return payment;
  }

  static async refundPayment(
    paymentId: string,
    session: ClientSession,
    refundReason?: string
  ): Promise<void> {
    const update: Record<string, unknown> = { isRefunded: true };
    if (refundReason) {
      update.refundReason = refundReason;
    }
    const result = await Payment.findByIdAndUpdate(
      paymentId,
      {
        $set: update,
      },
      { new: true, session }
    );
    if (!result)
      throw new NotFoundError("PAYMENT_NOT_FOUND", "Payment not found");
      
    // Send refund to ERP
    try {
      await refundPaymentToRentalSystem(result);
    } catch (error) {
      logger.error(`Failed to send refund for payment ${paymentId} to ERP`, error);
      // We do not throw an error here to prevent blocking the refund if ERP is down
    }
  }
}
