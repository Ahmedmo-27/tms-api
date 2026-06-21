import mongoose, { Document, Schema, Model, Types } from "mongoose";

export interface IWaitlistEntry extends Document {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  joinedAt: Date;
  position: number;
  status: "WAITING" | "NOTIFIED" | "BOOKED" | "EXPIRED" | "SKIPPED" | "CANCELLED";
  notifiedAt?: Date;
  reservationExpiresAt?: Date;
}

const WaitlistEntrySchema = new Schema<IWaitlistEntry>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "ScheduledClass",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    position: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["WAITING", "NOTIFIED", "BOOKED", "EXPIRED", "SKIPPED", "CANCELLED"],
      default: "WAITING",
      required: true,
      index: true,
    },
    notifiedAt: {
      type: Date,
    },
    reservationExpiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound index to ensure one active waitlist entry per user per session
WaitlistEntrySchema.index(
  { sessionId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["WAITING", "NOTIFIED"] } },
  }
);

const WaitlistEntry = mongoose.model<IWaitlistEntry>("WaitlistEntry", WaitlistEntrySchema);

export default WaitlistEntry;
