import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICoach extends Document {
    coachName: string;
    phoneNumber: string;
    userId?: Types.ObjectId;
    ptDropInPrice?: number | null;
}

const CoachSchema: Schema<ICoach> = new Schema({
    coachName: {
        type: String,
        required: true,
    },
    phoneNumber: {
        type: String,
        required: true,
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        unique: true,
        sparse: true,
    },
    ptDropInPrice: {
        type: Number,
        default: null,
        required: false,
    },
});

const Coach = mongoose.model<ICoach>("Coach", CoachSchema);

export default Coach;
