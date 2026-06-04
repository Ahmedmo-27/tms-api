import mongoose, { Schema, Document } from "mongoose";

export interface INotificationTemplate extends Document {
  key: string;
  title: string;
  body: string;
  category: "SCHEDULE" | "MARKETING" | "ANNOUNCMENT" | "SYSTEM" | "CUSTOM";
}

const NotificationTemplateSchema: Schema<INotificationTemplate> = new Schema({
  key: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: ["SCHEDULE", "MARKETING", "ANNOUNCMENT", "SYSTEM", "CUSTOM"],
  },
});

export const NotificationTemplate = mongoose.model<INotificationTemplate>(
  "NotificationTemplate",
  NotificationTemplateSchema
);
