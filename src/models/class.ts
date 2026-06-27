import mongoose, { Schema, Document, Types } from "mongoose";

export interface IClass extends Document {
  title: string;
  category: string;
  price: number;
  locations: Types.ObjectId[];
  points?: number;
  allowDropIn: boolean;
}


const ClassSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  locations: {
    type: [Schema.Types.ObjectId],
    ref: "Location",
    required: true,
    validate: {
      validator: (v: Types.ObjectId[]) => Array.isArray(v) && v.length > 0,
      message: "At least one location is required",
    },
  },
  points: {
    type: Number,
    default: 1,
    required: false,
  },
  allowDropIn: {
    type: Boolean,
    default: true,
  },
});

const Class = mongoose.model<IClass>("Class", ClassSchema);

export default Class;
