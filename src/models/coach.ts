import mongoose, { Document, Schema, Types } from "mongoose";

export interface ICoach extends Document {
    coachName: string;
    phoneNumber: string;
    userId?: Types.ObjectId;
    ptDropInPrice?: number | null;
    scansCategories?: string[];
    canViewPtReports?: boolean;
    isShadowCoach?: boolean;
    currentPhase?: number;
    trainingStartDate?: Date;
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
    scansCategories: {
        type: [String],
        default: undefined,
        required: false,
    },
    canViewPtReports: {
        type: Boolean,
        default: false,
        required: false,
    },
    isShadowCoach: {
        type: Boolean,
        default: false,
        required: false,
    },
    currentPhase: {
        type: Number,
        default: 1,
        min: 1,
        max: 3,
        required: false,
    },
    trainingStartDate: {
        type: Date,
        required: false,
    },
});

const Coach = mongoose.model<ICoach>("Coach", CoachSchema);

export default Coach;
