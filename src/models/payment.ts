import mongoose, { Document, Schema, Types } from "mongoose";

export interface IPayment extends Document {
  uid?: Types.ObjectId;
  nonMemberName: string;
  nonMemberPhone: string;
  amount: number;
  paymentMethod: "APP" | "VISA" | "CASH" | "INSTAPAY" | "VALU" | "PAYMENT_LINK" | "DEDUCTED" | "COACHERA";
  paymentTime: Date;
  orderId?: string;
  merchantReferenceId?: string;
  purpose:
    | "DROPIN"
    | "PACKAGE"
    | "WALKIN"
    | "NON_USER_BOOKING"
    | "NON_USER_PACKAGE"
    | "ONLINE_CLASS"
    | "OTHER";
  scid?: Types.ObjectId; // ref to ScheduledClass
  pkgId?: Types.ObjectId; // ref to Package
  note?: string;
  isRefunded: boolean;
  refundReason?: string;
  locationId?: Types.ObjectId;
  coachId?: Types.ObjectId;
  coachEmail?: string;
  coachName?: string;
  durationMonths?: number;
  platform?: string;
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
    enum: ["APP", "VISA", "CASH", "INSTAPAY", "VALU", "PAYMENT_LINK", "DEDUCTED", "COACHERA"],
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
      "ONLINE_CLASS",
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
  locationId: {
    type: Schema.Types.ObjectId,
    ref: "Location",
    required: false,
  },
  coachId: {
    type: Schema.Types.ObjectId,
    ref: "Coach",
    required: false,
  },
  coachEmail: {
    type: String,
    required: false,
  },
  coachName: {
    type: String,
    required: false,
  },
  durationMonths: {
    type: Number,
    required: false,
  },
  platform: {
    type: String,
    required: false,
  },
});

PaymentSchema.index({ paymentTime: -1 });
PaymentSchema.index({ locationId: 1, paymentTime: -1 });
PaymentSchema.index({ uid: 1 });
PaymentSchema.index({ orderId: 1 }, { sparse: true });
PaymentSchema.index({ coachEmail: 1 }, { sparse: true });

const Payment = mongoose.model<IPayment>("Payment", PaymentSchema);

export default Payment;
