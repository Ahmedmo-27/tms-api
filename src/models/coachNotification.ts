import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICoachNotification extends Document {
  coachId: Types.ObjectId;
  memberId: Types.ObjectId;
  memberName: string;
  packageName: string;
  classesTotal: number;
  read: boolean;
  createdAt: Date;
}

const CoachNotificationSchema = new Schema<ICoachNotification>({
  coachId: {
    type: Schema.Types.ObjectId,
    ref: "Coach",
    required: true,
    index: true,
  },
  memberId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  memberName: {
    type: String,
    required: true,
  },
  packageName: {
    type: String,
    required: true,
  },
  classesTotal: {
    type: Number,
    required: true,
  },
  read: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

CoachNotificationSchema.index({ coachId: 1, createdAt: -1 });

const CoachNotification = mongoose.model<ICoachNotification>(
  "CoachNotification",
  CoachNotificationSchema
);

export default CoachNotification;
