import { Schema, model, Types } from "mongoose";

export interface ICharityPlace {
  name: string;
  description: string;
  locationLink: string;
}

const CharityPlaceSchema = new Schema<ICharityPlace>({
  name: { type: String, required: true },
  description: { type: String, required: true },
  locationLink: { type: String, required: true },
});

export const CharityPlace = model<ICharityPlace>(
  "CharityPlace",
  CharityPlaceSchema
);