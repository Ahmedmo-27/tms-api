import mongoose, { Document, Schema } from "mongoose";

// Admin-editable list of problem types shown to users in the mobile app.
export interface ITicketCategory extends Document {
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TicketCategorySchema: Schema<ITicketCategory> = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // Inactive categories are kept for history but hidden from the app.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const TicketCategory = mongoose.model<ITicketCategory>(
  "TicketCategory",
  TicketCategorySchema
);

export default TicketCategory;
