import mongoose, { Document, Schema, Types } from "mongoose";

export interface IDeductionLog extends Document {
  coachId: Types.ObjectId;
  memberId: Types.ObjectId;
  pkgId: Types.ObjectId;
  memberPackageStartDate: Date;
  reason: string;
  sessionDate: Date;
  sessionType: "INDIVIDUAL" | "GROUP";
  classesRemainingAfter: number;
  createdAt: Date;
}

const DeductionLogSchema = new Schema<IDeductionLog>({
  coachId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  memberId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  pkgId: {
    type: Schema.Types.ObjectId,
    ref: "Package",
    required: false,
  },
  memberPackageStartDate: {
    type: Date,
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  sessionDate: {
    type: Date,
    required: true,
  },
  sessionType: {
    type: String,
    enum: ["INDIVIDUAL", "GROUP"],
    required: true,
  },
  classesRemainingAfter: {
    type: Number,
    min: 0,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

const DeductionLog = mongoose.model<IDeductionLog>(
  "DeductionLog",
  DeductionLogSchema
);

export default DeductionLog;
