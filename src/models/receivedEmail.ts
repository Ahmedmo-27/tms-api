import mongoose, { Schema, Document } from "mongoose";

export interface IReceivedEmail extends Document {
  from: string;
  subject: string;
  text: string;
  html: string;
  date: Date;
  messageId: string;
  isRead: boolean;
}

const ReceivedEmailSchema: Schema<IReceivedEmail> = new Schema({
  from: {
    type: String,
    required: true,
  },
  subject: {
    type: String,
    required: false,
    default: "",
  },
  text: {
    type: String,
    required: false,
    default: "",
  },
  html: {
    type: String,
    required: false,
    default: "",
  },
  date: {
    type: Date,
    required: true,
  },
  messageId: {
    type: String,
    required: true,
    unique: true, // Prevent duplicate syncing
  },
  isRead: {
    type: Boolean,
    default: false,
  },
});

const ReceivedEmail = mongoose.model<IReceivedEmail>("ReceivedEmail", ReceivedEmailSchema);

export default ReceivedEmail;
