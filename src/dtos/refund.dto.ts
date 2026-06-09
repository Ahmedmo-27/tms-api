import { Types, Document } from "mongoose";
import { IRefund } from "../models/refund";
import { IUser } from "../models/user";
import { IPayment } from "../models/payment";
import { IPackage } from "../models/package";

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface CreateMemberRefundDto {
  reason: string;
  amount: number;
  memberName: string;
  memberId?: string;
  paymentId?: string;
}

export interface CreateCashOutDto {
  reason: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface RefundResponseDto {
  _id: string;
  type: "REFUND" | "CASHOUT";
  reason: string;
  amount: number;
  memberName: string | null;
  memberId: string | null;
  paymentId: string | null;
  recordedBy: { _id: string; name: string };
  createdAt: Date;
}

export interface MemberSearchResultDto {
  _id: string;
  name: string;
  phoneNumber: string;
  email: string;
}

export interface MemberRecentPaymentDto {
  _id: string;
  amount: number;
  paymentMethod: string;
  paymentTime: Date;
  purpose: IPayment["purpose"];
  itemName: string;
  label: string;
  isRefunded: boolean;
}

const PAYMENT_PURPOSE_LABELS: Record<IPayment["purpose"], string> = {
  DROPIN: "Drop-in",
  PACKAGE: "Package",
  WALKIN: "Walk-in",
  NON_USER_BOOKING: "Non-user booking",
  NON_USER_PACKAGE: "Non-user package",
  OTHER: "Other",
};

function formatPaymentDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getPaymentItemName(payment: IPayment): string {
  if (payment.purpose === "PACKAGE" && payment.pkgId) {
    return (payment.pkgId as unknown as IPackage).name;
  }

  if (payment.scid) {
    const scheduledClass = payment.scid as unknown as {
      cid?: { title?: string };
    };
    if (scheduledClass.cid?.title) {
      return scheduledClass.cid.title;
    }
  }

  return PAYMENT_PURPOSE_LABELS[payment.purpose];
}

export function mapMemberRecentPaymentDto(payment: IPayment): MemberRecentPaymentDto {
  const itemName = getPaymentItemName(payment);
  const purposeLabel = PAYMENT_PURPOSE_LABELS[payment.purpose];

  return {
    _id: (payment._id as Types.ObjectId).toString(),
    amount: payment.amount,
    paymentMethod: payment.paymentMethod,
    paymentTime: payment.paymentTime,
    purpose: payment.purpose,
    itemName,
    label: `${purposeLabel}: ${itemName} · EGP ${payment.amount} · ${formatPaymentDate(payment.paymentTime)}`,
    isRefunded: payment.isRefunded,
  };
}

// ---------------------------------------------------------------------------
// Mapper functions
// ---------------------------------------------------------------------------

export function mapRefundResponseDto(refund: IRefund): RefundResponseDto {
  const recordedBy = refund.recordedBy as unknown as {
    _id: Types.ObjectId;
    name: string;
  };

  return {
    _id: (refund._id as Types.ObjectId).toString(),
    type: refund.type,
    reason: refund.reason,
    amount: refund.amount,
    memberName: refund.memberName,
    memberId: refund.memberId ? refund.memberId.toString() : null,
    paymentId: refund.paymentId ? refund.paymentId.toString() : null,
    recordedBy: {
      _id: recordedBy._id.toString(),
      name: recordedBy.name,
    },
    createdAt: refund.createdAt,
  };
}

export function mapMemberSearchResultDto(
  user: Pick<IUser, "name" | "phoneNumber" | "email"> & Document
): MemberSearchResultDto {
  return {
    _id: (user._id as Types.ObjectId).toString(),
    name: user.name,
    phoneNumber: user.phoneNumber,
    email: user.email,
  };
}
