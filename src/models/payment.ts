import mongoose, { Document, Schema, Types } from "mongoose";

export interface IPayment extends Document {
  uid?: Types.ObjectId;
  nonMemberName: string;
  nonMemberPhone: string;
  amount: number;
  paymentMethod: "APP" | "VISA" | "CASH" | "INSTAPAY" | "VALU" | "PAYMENT_LINK" | "DEDUCTED";
  paymentTime: Date;
  orderId?: string;
  merchantReferenceId?: string;
  purpose:
    | "DROPIN"
    | "PACKAGE"
    | "WALKIN"
    | "NON_USER_BOOKING"
    | "NON_USER_PACKAGE"
    | "OTHER";
  scid?: Types.ObjectId; // ref to ScheduledClass
  pkgId?: Types.ObjectId; // ref to Package
  note?: string;
  isRefunded: boolean;
  refundReason?: string;
}

const PaymentSchema = new Schema({
  uid: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  nonMemberName: {
    type: String,
    required: false,
  },
  nonMemberPhone: {
    type: String,
    required: false,
  },
  amount: {
    type: Number,
    required: true,
  },
  paymentMethod: {
    type: String,
    enum: ["APP", "VISA", "CASH", "INSTAPAY", "VALU", "PAYMENT_LINK", "DEDUCTED"],
    required: true,
  },
  paymentTime: {
    type: Date,
    required: true,
  },
  orderId: {
    type: String,
  },
  merchantReferenceId: {
    type: String,
  },
  purpose: {
    type: String,
    required: true,
    enum: [
      "DROPIN",
      "PACKAGE",
      "WALKIN",
      "NON_USER_BOOKING",
      "NON_USER_PACKAGE",
      "OTHER",
    ],
  },
  scid: {
    type: Schema.Types.ObjectId,
    ref: "ScheduledClass",
    required: false,
  },
  pkgId: {
    type: Schema.Types.ObjectId,
    ref: "Package",
    required: false,
  },
  note: {
    type: String,
    required: false,
  },
  isRefunded: {
    type: Boolean,
    default: false,
  },
  refundReason: {
    type: String,
    required: false,
  },
});

const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);

export default Payment;
