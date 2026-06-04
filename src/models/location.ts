
import mongoose, { Schema, Document } from "mongoose";

export interface ILocation extends Document {
  branchName: string;
  location: string;
  locationUrl: string;
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
});

const Location = mongoose.model<ILocation>("Location", LocationSchema);

export default Location;
