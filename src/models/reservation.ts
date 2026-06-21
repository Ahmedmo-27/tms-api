import mongoose, { Document, Schema, Model, Types } from "mongoose";

export interface IReservation extends Document {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  status: "ACTIVE" | "EXPIRED" | "COMPLETED" | "CANCELLED";
  createdAt: Date;
  expiresAt: Date;
  paymentStatus?: "PENDING" | "PAID";
}

const ReservationSchema = new Schema<IReservation>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "ScheduledClass",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "COMPLETED", "CANCELLED"],
      default: "ACTIVE",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true, // important for cron job fetching expired
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID"],
      default: "PENDING",
    },
  },
  {
    timestamps: true,
  }
);

// Only one ACTIVE reservation per slot (globally across the class session)
// This strictly enforces "Only one user may receive an offer at a time."
ReservationSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" },
  }
);

const Reservation = mongoose.model<IReservation>("Reservation", ReservationSchema);

export default Reservation;
