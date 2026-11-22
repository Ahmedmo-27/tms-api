import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICoachNotification extends Document {
  coachId: Types.ObjectId;
  type?: "package_assignment" | "class_assignment";
  title?: string;
  message?: string;
  scheduledClassId?: Types.ObjectId;
  classTitle?: string;
  startTime?: Date;
  endTime?: Date;
  locationName?: string;
  leadCoachName?: string;
  memberId?: Types.ObjectId;
  memberName?: string;
  packageName?: string;
  classesTotal?: number;
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
  type: {
    type: String,
    enum: ["package_assignment", "class_assignment"],
    default: "package_assignment",
  },
  title: {
    type: String,
    required: false,
  },
  message: {
    type: String,
    required: false,
  },
  scheduledClassId: {
    type: Schema.Types.ObjectId,
    ref: "ScheduledClass",
    required: false,
  },
  classTitle: {
    type: String,
    required: false,
  },
  startTime: {
    type: Date,
    required: false,
  },
  endTime: {
    type: Date,
    required: false,
  },
  locationName: {
    type: String,
    required: false,
  },
  leadCoachName: {
    type: String,
    required: false,
  },
  memberId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  memberName: {
    type: String,
    required: false,
  },
  packageName: {
    type: String,
    required: false,
  },
  classesTotal: {
    type: Number,
    required: false,
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
