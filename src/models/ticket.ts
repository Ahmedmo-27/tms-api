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
  handledByName?: string;
  handledByRole?: string;
  statusUpdatedBy?: Types.ObjectId;
  statusUpdatedByName?: string;
  statusUpdatedByRole?: string;
  statusUpdatedAt?: Date;
  notesUpdatedBy?: Types.ObjectId;
  notesUpdatedByName?: string;
  notesUpdatedByRole?: string;
  notesUpdatedAt?: Date;
  locationId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  creatorRole?: string;
  creatorName?: string;
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
    handledByName: { type: String, trim: true },
    handledByRole: { type: String, trim: true },
    statusUpdatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    statusUpdatedByName: { type: String, trim: true },
    statusUpdatedByRole: { type: String, trim: true },
    statusUpdatedAt: { type: Date },
    notesUpdatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notesUpdatedByName: { type: String, trim: true },
    notesUpdatedByRole: { type: String, trim: true },
    notesUpdatedAt: { type: Date },
    locationId: { type: Schema.Types.ObjectId, ref: "Location", default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    creatorRole: { type: String, trim: true },
    creatorName: { type: String, trim: true },
  },
  { timestamps: true }
);

const Ticket = mongoose.model<ITicket>("Ticket", TicketSchema);

export default Ticket;
