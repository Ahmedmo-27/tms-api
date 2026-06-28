import mongoose, { Document, Schema, Types } from "mongoose";

// Lifecycle of a support ticket.
export const TICKET_STATUSES = [
  "pending",
  "in_progress",
  "resolved",
  "rejected",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface ITicket extends Document {
  name: string;
  phone: string;
  email: string;
  // Category name chosen from the list, or the literal "Other".
  category: string;
  // Free text the user typed when they chose "Other".
  otherDetails?: string;
  description: string;
  status: TicketStatus;
  // Notes added by staff when resolving / rejecting.
  adminNotes?: string;
  // Staff member who last actioned the ticket.
  handledBy?: Types.ObjectId;
  locationId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema: Schema<ITicket> = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    category: { type: String, required: true, trim: true },
    otherDetails: { type: String, trim: true },
    description: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: [...TICKET_STATUSES],
      default: "pending",
      index: true,
    },
    adminNotes: { type: String, trim: true },
    handledBy: { type: Schema.Types.ObjectId, ref: "User" },
    locationId: { type: Schema.Types.ObjectId, ref: "Location", default: null, index: true },
  },
  { timestamps: true }
);

const Ticket = mongoose.model<ITicket>("Ticket", TicketSchema);

export default Ticket;
