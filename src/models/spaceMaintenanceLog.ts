import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMaintenanceCheckItem {
  id: "showers_bottles" | "towels" | "communal_area" | "gym_prepared";
  title: string;
  isCompleted: boolean;
  completedAt?: Date | null;
  completedBy?: mongoose.Types.ObjectId | null;
  completedByName?: string;
  notes?: string;
}

export type MaintenanceOverallStatus = "pending" | "in_progress" | "completed";

export interface ISpaceMaintenanceLog extends Document {
  locationId: mongoose.Types.ObjectId;
  slotDate: string; // YYYY-MM-DD in Africa/Cairo
  slotHour: number; // 0-23
  slotStartTime: Date;
  items: IMaintenanceCheckItem[];
  overallStatus: MaintenanceOverallStatus;
  completedAt?: Date | null;
  lastUpdatedBy?: mongoose.Types.ObjectId | null;
  lastUpdatedByName?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_MAINTENANCE_ITEMS: Array<Pick<IMaintenanceCheckItem, "id" | "title">> = [
  { id: "showers_bottles", title: "Showers bottles" },
  { id: "towels", title: "Towels" },
  { id: "communal_area", title: "Communal area is tidy" },
  { id: "gym_prepared", title: "Gym is well prepared" },
];

const MaintenanceCheckItemSchema = new Schema<IMaintenanceCheckItem>(
  {
    id: {
      type: String,
      required: true,
      enum: ["showers_bottles", "towels", "communal_area", "gym_prepared"],
    },
    title: {
      type: String,
      required: true,
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedByName: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const SpaceMaintenanceLogSchema = new Schema<ISpaceMaintenanceLog>(
  {
    locationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
      index: true,
    },
    slotDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    slotHour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
      index: true,
    },
    slotStartTime: {
      type: Date,
      required: true,
    },
    items: {
      type: [MaintenanceCheckItemSchema],
      default: () =>
        DEFAULT_MAINTENANCE_ITEMS.map((item) => ({
          ...item,
          isCompleted: false,
          completedAt: null,
          completedBy: null,
          completedByName: "",
          notes: "",
        })),
    },
    overallStatus: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastUpdatedByName: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// One maintenance log per branch per hour
SpaceMaintenanceLogSchema.index(
  { locationId: 1, slotDate: 1, slotHour: 1 },
  { unique: true }
);

const SpaceMaintenanceLog: Model<ISpaceMaintenanceLog> =
  mongoose.models.SpaceMaintenanceLog ||
  mongoose.model<ISpaceMaintenanceLog>("SpaceMaintenanceLog", SpaceMaintenanceLogSchema);

export default SpaceMaintenanceLog;
