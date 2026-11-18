
import mongoose, { Schema, Document } from "mongoose";

export interface ILocation extends Document {
  branchName: string;
  location: string;
  locationUrl: string;
  paymentsPin?: string;
}

const LocationSchema = new Schema({
  branchName: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  locationUrl: {
    type: String,
    required: true,
  },
  paymentsPin: {
    type: String,
    default: "1967",
  },
});

const Location = mongoose.model<ILocation>("Location", LocationSchema);

export default Location;
