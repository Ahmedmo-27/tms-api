import Payment from "../models/payment";
import Refund, { IRefund } from "../models/refund";
import { ClientSession, Types } from "mongoose";
import axios from "axios";
import { BadRequestError, NotFoundError } from "../core/ApiError";
import { IPayment } from "../models/payment";
import logger from "../config/logger";
import { refundPaymentToRentalSystem } from "./egygap-erp-service";
import { startOfDay, endOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export type PaymentListEntry = IPayment & {
  entryType?: "REFUND" | "CASHOUT";
  isMoneyOut?: boolean;
  refundId?: Types.ObjectId;
  linkedPaymentId?: Types.ObjectId | null;
};

function buildDateRangeQuery(
  dateField: string,
  dateString?: string,
  month?: number,
  year?: number
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const currentYear = new Date().getUTCFullYear();
  const targetYear = year || currentYear;
  const timeZone = "Africa/Cairo";

  if (dateString && dateString !== "") {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const start = toZonedTime(startOfDay(date), timeZone);
      const end = toZonedTime(endOfDay(date), timeZone);
      query[dateField] = { $gte: start, $lte: end };
    }
  } else if (month) {
    const m = month - 1;
    // For month queries, we can construct the date strings to ensure they are interpreted correctly
    const startStr = `${targetYear}-${String(m + 1).padStart(2, '0')}-01T00:00:00`;
    const startDate = new Date(startStr);
    
    // Get the last day of the month
    const nextMonthStr = `${m === 11 ? targetYear + 1 : targetYear}-${String(m === 11 ? 1 : m + 2).padStart(2, '0')}-01T00:00:00`;
    const endDate = new Date(nextMonthStr);

    const start = toZonedTime(startDate, timeZone);
    const end = toZonedTime(endDate, timeZone);
    query[dateField] = { $gte: start, $lt: end };
  }

  return query;
}

function mapRefundToPaymentEntry(refund: IRefund): PaymentListEntry {
  const isCashOut = refund.type === "CASHOUT";

  return {
    _id: refund._id as Types.ObjectId,
    uid: refund.memberId ?? undefined,
    nonMemberName: isCashOut ? "Cash Out" : (refund.memberName ?? ""),
    nonMemberPhone: "",
    // Negative amount so daily revenue totals subtract cash outs and refunds
    amount: -refund.amount,
    paymentMethod: "CASH",
    paymentTime: refund.createdAt,
    purpose: "OTHER",
    isRefunded: !isCashOut,
    refundReason: refund.reason,
    note: refund.reason,
    entryType: refund.type,
    isMoneyOut: true,
    refundId: refund._id as Types.ObjectId,
    linkedPaymentId: refund.paymentId,
  } as PaymentListEntry;
}

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
  ): Promise<PaymentListEntry[]> {
    const paymentQuery = buildDateRangeQuery(
      "paymentTime",
      dateString,
      month,
      year
    );
    const refundQuery = {
      ...buildDateRangeQuery("createdAt", dateString, month, year),
      // Standalone refunds/cash outs only — linked refunds already appear on their Payment row
      paymentId: null,
    };

    const [payments, refunds] = await Promise.all([
      Payment.find(paymentQuery)
        .populate("uid")
        .populate({
          path: "scid",
          populate: { path: "cid", populate: { path: "locations" } },
        })
        .populate("pkgId"),
      Refund.find(refundQuery)
        .populate("memberId", "name phoneNumber email")
        .sort({ createdAt: -1 }),
    ]);

    const refundEntries = refunds.map((refund) => {
      const entry = mapRefundToPaymentEntry(refund);
      if (refund.memberId) {
        entry.uid = refund.memberId as Types.ObjectId;
      }
      return entry;
    });

    return [...payments, ...refundEntries].sort(
      (a, b) =>
        new Date(b.paymentTime).getTime() - new Date(a.paymentTime).getTime()
    );
  }

  static async getExposedPayments(
    dateString?: string,
    month?: number,
    year?: number
  ): Promise<any> {
    const query: Record<string, any> = {};

    const currentYear = new Date().getUTCFullYear();
    const targetYear = year || currentYear;
    const timeZone = "Africa/Cairo";

    if (dateString && dateString !== "") {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        const start = toZonedTime(startOfDay(date), timeZone);
        const end = toZonedTime(endOfDay(date), timeZone);
        query.paymentTime = {
          $gte: start,
          $lt: end,
        };
      }
    } else if (month) {
      const m = month - 1;
      const startStr = `${targetYear}-${String(m + 1).padStart(2, '0')}-01T00:00:00`;
      const startDate = new Date(startStr);
      
      const nextMonthStr = `${m === 11 ? targetYear + 1 : targetYear}-${String(m === 11 ? 1 : m + 2).padStart(2, '0')}-01T00:00:00`;
      const endDate = new Date(nextMonthStr);

      const start = toZonedTime(startDate, timeZone);
      const end = toZonedTime(endDate, timeZone);
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
