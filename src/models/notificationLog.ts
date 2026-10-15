import mongoose, { Schema, Document, Types } from "mongoose";

export type NotificationCategory =
  | "GENERAL"
  | "ANNOUNCEMENT"
  | "SCHEDULE"
  | "PROMO"
  | "ALERT";

export type NotificationTargetType =
  | "all"
  | "members"
  | "coaches"
  | "branch"
  | "custom";

export interface INotificationLog extends Document {
  title: string;
  body: string;
  category: NotificationCategory;
  targetType: NotificationTargetType;
  locationId?: Types.ObjectId;
  recipientCount: number;
  recipientIds?: Types.ObjectId[];
  sentBy?: Types.ObjectId;
  sentByName?: string;
  status: "sent" | "partial" | "failed";
  metadata?: Record<string, string>;
  createdAt: Date;
}

const NotificationLogSchema = new Schema<INotificationLog>(
  {
    title: {
      type: String,
      required: true,
      default: "THE MIND SPACE.",
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["GENERAL", "ANNOUNCEMENT", "SCHEDULE", "PROMO", "ALERT"],
      default: "GENERAL",
    },
    targetType: {
      type: String,
      required: true,
      enum: ["all", "members", "coaches", "branch", "custom"],
      default: "custom",
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: false,
    },
    recipientCount: {
      type: Number,
      required: true,
      default: 0,
    },
    recipientIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    sentBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    sentByName: {
      type: String,
      required: false,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["sent", "partial", "failed"],
      default: "sent",
    },
    metadata: {
      type: Map,
      of: String,
      required: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  }
);

NotificationLogSchema.index({ createdAt: -1 });
NotificationLogSchema.index({ targetType: 1, createdAt: -1 });

export const NotificationLog = mongoose.model<INotificationLog>(
  "NotificationLog",
  NotificationLogSchema
);

export default NotificationLog;
