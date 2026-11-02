import mongoose, { Document, Schema, Types, Model } from "mongoose";

export type OwedPtSessionStatus = "PENDING" | "DEDUCTED" | "PAID" | "WAIVED" | "FOC";

export interface IOwedPtSession extends Document {
  phoneNumber: string;
  uid?: Types.ObjectId;
  clientName: string;
  coachId: Types.ObjectId;
  coachName?: string;
  locationId?: Types.ObjectId;
  dailyAttendanceId: Types.ObjectId;
  attendanceRowId: Types.ObjectId;
  attendanceDate: Date;
  amount?: number;
  status: OwedPtSessionStatus;
  settledPackageId?: Types.ObjectId;
  settledPaymentId?: Types.ObjectId;
  settledAt?: Date;
  settledBy?: Types.ObjectId;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OwedPtSessionModel = Model<IOwedPtSession>;

const OwedPtSessionSchema = new Schema<IOwedPtSession, OwedPtSessionModel>(
  {
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    uid: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    clientName: {
      type: String,
      required: true,
      trim: true,
    },
    coachId: {
      type: Schema.Types.ObjectId,
      ref: "Coach",
      required: true,
      index: true,
    },
    coachName: {
      type: String,
      required: false,
      trim: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: false,
    },
    dailyAttendanceId: {
      type: Schema.Types.ObjectId,
      ref: "DailyAttendance",
      required: true,
      index: true,
    },
    attendanceRowId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    attendanceDate: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      enum: ["PENDING", "DEDUCTED", "PAID", "WAIVED", "FOC"],
      default: "PENDING",
      index: true,
    },
    settledPackageId: {
      type: Schema.Types.ObjectId,
      ref: "Package",
      required: false,
    },
    settledPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: false,
    },
    settledAt: {
      type: Date,
      required: false,
    },
    settledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    note: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast lookup during check-in and package assignment
OwedPtSessionSchema.index({ phoneNumber: 1, status: 1 });
OwedPtSessionSchema.index({ uid: 1, status: 1 });
OwedPtSessionSchema.index({ coachId: 1, status: 1 });
OwedPtSessionSchema.index({ dailyAttendanceId: 1, attendanceRowId: 1 });

const OwedPtSession = mongoose.model<IOwedPtSession, OwedPtSessionModel>(
  "OwedPtSession",
  OwedPtSessionSchema
);

export default OwedPtSession;
