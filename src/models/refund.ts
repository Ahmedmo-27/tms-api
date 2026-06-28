import mongoose, { Document, Schema, Types } from "mongoose";

export interface IRefund extends Document {
  type: "REFUND" | "CASHOUT";
  reason: string;
  amount: number;
  memberName: string | null;
  memberId: Types.ObjectId | null;
  paymentId: Types.ObjectId | null;
  recordedBy: Types.ObjectId;
  locationId: Types.ObjectId | null;
  createdAt: Date;
}

const RefundSchema = new Schema<IRefund>({
  type: {
    type: String,
    enum: ["REFUND", "CASHOUT"],
    required: true,
  },
  reason: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  memberName: {
    type: String,
    trim: true,
    default: null,
  },
  memberId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  paymentId: {
    type: Schema.Types.ObjectId,
    ref: "Payment",
    default: null,
  },
  recordedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  locationId: {
    type: Schema.Types.ObjectId,
    ref: "Location",
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

RefundSchema.index({ paymentId: 1 });
RefundSchema.index({ type: 1 });
RefundSchema.index({ createdAt: -1 });
RefundSchema.index({ locationId: 1 });

const Refund = mongoose.model<IRefund>("Refund", RefundSchema);

export default Refund;
