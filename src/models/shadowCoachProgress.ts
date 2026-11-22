import mongoose, { Document, Schema, Types } from "mongoose";

export interface IChecklistItem {
  key: string;
  task: string;
  isDone: boolean;
  completedAt?: Date;
  completedByCoachId?: Types.ObjectId;
  completedByCoachName?: string;
  completedInClassId?: Types.ObjectId;
  notes?: string;
}

export interface IPhaseProgress {
  phaseNumber: number; // 1, 2, 3
  title: string;
  guidelines?: string;
  checklist: IChecklistItem[];
}

export interface IShadowCoachProgress extends Document {
  coachId: Types.ObjectId;
  userId: Types.ObjectId;
  currentPhase: number; // 1, 2, 3
  startDate: Date;
  completedDate?: Date;
  status: "in_progress" | "completed_pending_review" | "graduated" | "retained";
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewDecision?: "promoted" | "retained";
  reviewNotes?: string;
  phases: IPhaseProgress[];
  createdAt: Date;
  updatedAt: Date;
}

export const STANDARD_SHADOW_COACH_CURRICULUM: {
  phaseNumber: number;
  title: string;
  guidelines?: string;
  checklist: { key: string; task: string }[];
}[] = [
  {
    phaseNumber: 1,
    title: "Observe + support",
    checklist: [
      {
        key: "m1_equip",
        task: "Assist equipment setup, music and microphone",
      },
      {
        key: "m1_welcome",
        task: "Warmly welcome members and learn names",
      },
      {
        key: "m1_warmup_support",
        task: "Help late arrivals with the approved warm-up under direction",
      },
      {
        key: "m1_observe_flow",
        task: "Observe briefing, pace, class flow and safety",
      },
    ],
  },
  {
    phaseNumber: 2,
    title: "Assist + demonstrate",
    guidelines:
      "Demonstrate exercises and correct member form under supervision. Do not brief class segments, or prescribe progressions/regressions.",
    checklist: [
      {
        key: "m2_demo",
        task: "Demonstrate the exercises while the lead coach explains and cues them",
      },
      {
        key: "m2_correct_form",
        task: "Correct member exercise form under supervision",
      },
      {
        key: "m2_cooldown",
        task: "Help with cooldown/stretching and setup",
      },
    ],
  },
  {
    phaseNumber: 3,
    title: "Coach + lead (supervised)",
    guidelines:
      "Lead warm-up and room coaching. If the Head Coach deems the candidate ready, brief and run one complete class segment under supervision.",
    checklist: [
      {
        key: "m3_lead_warmup",
        task: "Lead the warm-up",
      },
      {
        key: "m3_coach_room",
        task: "Actively coach the room, including appropriate progressions/regressions",
      },
      {
        key: "m3_lead_segment",
        task: "If the Head Coach deems the candidate ready, brief and run one complete class segment under supervision",
      },
      {
        key: "m3_engagement",
        task: "Continue member engagement and class support",
      },
    ],
  },
];

const ChecklistItemSchema = new Schema(
  {
    key: { type: String, required: true },
    task: { type: String, required: true },
    isDone: { type: Boolean, default: false },
    completedAt: { type: Date },
    completedByCoachId: { type: Schema.Types.ObjectId, ref: "Coach" },
    completedByCoachName: { type: String },
    completedInClassId: { type: Schema.Types.ObjectId, ref: "ScheduledClass" },
    notes: { type: String },
  },
  { _id: false }
);

const PhaseProgressSchema = new Schema(
  {
    phaseNumber: { type: Number, required: true },
    title: { type: String, required: true },
    guidelines: { type: String },
    checklist: [ChecklistItemSchema],
  },
  { _id: false }
);

const ShadowCoachProgressSchema = new Schema<IShadowCoachProgress>(
  {
    coachId: {
      type: Schema.Types.ObjectId,
      ref: "Coach",
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    currentPhase: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 3,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    completedDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed_pending_review", "graduated", "retained"],
      default: "in_progress",
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: {
      type: Date,
    },
    reviewDecision: {
      type: String,
      enum: ["promoted", "retained"],
    },
    reviewNotes: {
      type: String,
    },
    phases: [PhaseProgressSchema],
  },
  {
    timestamps: true,
  }
);

export const buildInitialPhases = (): IPhaseProgress[] => {
  return STANDARD_SHADOW_COACH_CURRICULUM.map((p) => ({
    phaseNumber: p.phaseNumber,
    title: p.title,
    guidelines: p.guidelines,
    checklist: p.checklist.map((c) => ({
      key: c.key,
      task: c.task,
      isDone: false,
    })),
  }));
};

const ShadowCoachProgress = mongoose.model<IShadowCoachProgress>(
  "ShadowCoachProgress",
  ShadowCoachProgressSchema
);

export default ShadowCoachProgress;
