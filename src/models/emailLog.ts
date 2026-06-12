import mongoose, { Schema, Document, Types } from "mongoose";

export interface IEmailLog extends Document {
  mode: "broadcast" | "members" | "coaches" | "manual";
  subject: string;
  body: string;
  recipients: string[] | number;
  sent_at: Date;
  status: "sent" | "failed";
  error_msg?: string;
  sent_by?: Types.ObjectId;
}

const EmailLogSchema: Schema<IEmailLog> = new Schema({
  mode: {
    type: String,
    required: true,
    enum: ["broadcast", "members", "coaches", "manual"],
  },
  subject: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  recipients: {
    type: Schema.Types.Mixed, // Can be array of strings or a number count
    required: true,
  },
  sent_at: {
    type: Date,
    required: true,
    default: Date.now,
  },
  status: {
    type: String,
    required: true,
    enum: ["sent", "failed"],
  },
  error_msg: {
    type: String,
    required: false,
  },
  sent_by: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
});

const EmailLog = mongoose.model<IEmailLog>("EmailLog", EmailLogSchema);

export default EmailLog;
