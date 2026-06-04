import { Schema, model, Document, Types } from "mongoose";

export interface IRamadanPost extends Document {
  uid: string;          // User ID
  task: string;         // Task description
  url: string;          // URL of the post (e.g., image or video)
  likes: string[];      // Array of user IDs who liked the post
  time: Date;           // Timestamp
}

const ramadanPostSchema = new Schema<IRamadanPost>(
  {
    uid: { type: String, required: true, ref: "User" },
    task: { type: String, required: true },
    url: { type: String, required: true },
    likes: [{ type: String, ref: "User" }], // Array of user IDs who liked the post
    time: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true } // optional, adds createdAt & updatedAt
);

export default model<IRamadanPost>("RamadanPost", ramadanPostSchema);