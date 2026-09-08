import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFreezeRequest extends Document {
  memberId: Types.ObjectId;
  pkgId: Types.ObjectId;
  pkgStartDate: Date;
  pkgName: string;
  locationId?: Types.ObjectId;
  requestedDurationDays: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  approvedDurationDays?: number;
  adminNote?: string;
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FreezeRequestSchema: Schema<IFreezeRequest> = new Schema(
  {
    memberId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pkgId: {
      type: Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    pkgStartDate: {
      type: Date,
      required: true,
    },
    pkgName: {
      type: String,
      required: false,
      default: "Package",
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: false,
      default: null,
      index: true,
    },
    requestedDurationDays: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    approvedDurationDays: {
      type: Number,
      required: false,
      min: 1,
    },
    adminNote: {
      type: String,
      required: false,
      trim: true,
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    reviewedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

FreezeRequestSchema.index({ memberId: 1, pkgId: 1, status: 1 });
FreezeRequestSchema.index({ createdAt: -1 });

const FreezeRequest = mongoose.model<IFreezeRequest>(
  "FreezeRequest",
  FreezeRequestSchema
);

export default FreezeRequest;
