import mongoose, { Document, Schema } from "mongoose";

export interface ICoach extends Document{
    coachName: string;
    phoneNumber: string;
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
});

const Coach = mongoose.model<ICoach>("Coach", CoachSchema);

export default Coach;
