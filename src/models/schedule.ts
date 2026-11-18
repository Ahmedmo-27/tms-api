import mongoose, {
  Schema,
  Document,
  Model,
  Types,
  ClientSession,
} from "mongoose";
import ScheduledClass, { IScheduledClass } from "./scheduledClass";
import { NotFoundError } from "../core/ApiError";
import logger from "../config/logger";

export interface ISchedule extends Document {
  date: Date;
  classes: Types.ObjectId[];
}

function normalizeDate(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

type ScheduleModel = Model<ISchedule> & {
  getClasses(date: string): Promise<string[]>;
  getAllClasses(): Promise<string[]>;
  getNextClasses(): Promise<string[]>;
  scheduleClass(scid: string): Promise<void>;
  cancelClass(scid: string, session: ClientSession): Promise<void>;
  rescheduleClass(
    oldClass: IScheduledClass,
    newClass: IScheduledClass,
    session: ClientSession
  ): Promise<void>;
};

const ScheduleSchema: Schema<ISchedule, ScheduleModel> = new Schema({
  date: {
    type: Date,
    required: true,
  },
  classes: [Schema.Types.ObjectId],
});

ScheduleSchema.static(
  "rescheduleClass",
  async function (
    oldClass: IScheduledClass,
    newClass: IScheduledClass,
    session: ClientSession
  ) {
    logger.info("Old class: ", { oldClass });
    logger.info("New class updates: ", { newClass });
    const oldDate = normalizeDate(oldClass.startTime);
    const newDate = normalizeDate(newClass.startTime);

    const clearedSchedule = await Schedule.findOneAndUpdate(
      { date: oldDate },
      { $pull: { classes: oldClass._id } },
      { session, new: true }
    );


    const cls = await ScheduledClass.findById(newClass._id, null, { session });
    if (!cls)
      throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", {
        scid: newClass._id,
      });

    const updatedSchedule = await Schedule.findOneAndUpdate(
      { date: newDate },
      { $addToSet: { classes: newClass._id } },
      { session, upsert: true, new: true }
    );
  }
);

ScheduleSchema.static("getClasses", async function (date: string) {
  const schedule = await Schedule.findOne({ date });
  if (!schedule) return [];
  const classes = schedule.classes.map((c) => c.toString());
  return classes;
});

ScheduleSchema.static("getAllClasses", async function () {
  const schedule = await Schedule.find();
  if (!schedule) return [];
  const classes = schedule.flatMap((s) => s.classes.map((c) => c.toString()));
  return classes;
});

ScheduleSchema.static("getNextClasses", async function () {
  const today = new Date().setUTCHours(0, 0, 0, 0);
  const schedule = await Schedule.find({ date: { $gte: today } });
  if (!schedule) return [];
  const classes = schedule.flatMap((s) => s.classes.map((c) => c.toString()));
  return classes;
});

ScheduleSchema.static("scheduleClass", async function (scid: string) {
  const cls = await ScheduledClass.findById(scid);
  if (!cls)
    throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
  let schedule = await Schedule.findOne({
    date: cls.startTime.toLocaleDateString(),
  });
  if (!schedule) {
    schedule = new Schedule({
      date: cls.startTime.toLocaleDateString(),
      classes: [new Types.ObjectId(scid as string)],
    });
  } else {
    if (schedule.classes.includes(new Types.ObjectId(scid as string))) return; // class already scheduled for this date
    schedule.classes.push(new Types.ObjectId(scid as string));
  }
  await schedule.save();
});

ScheduleSchema.static(
  "cancelClass",
  async function (scid: string, session: ClientSession) {
    // Remove the class from whichever day's schedule references it. If no
    // schedule references it (an orphaned ScheduledClass), there is nothing
    // to remove ? that must not block cancelling the class itself.
    const result = await Schedule.updateMany(
      { classes: new Types.ObjectId(scid) },
      { $pull: { classes: new Types.ObjectId(scid) } },
      { session }
    );
    if (result.matchedCount === 0)
      logger.warn("cancelClass: class was not in any schedule", { scid });
  }
);

const Schedule = mongoose.model<ISchedule, ScheduleModel>(
  "Schedule",
  ScheduleSchema
);

export default Schedule;
