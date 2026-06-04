import mongoose, {
  Schema,
  Model,
  Document,
  Types,
  ClientSession,
} from "mongoose";

// ============= INTERFACES =============

interface IRunEntry {
  distance: number;
  pace: number;
  duration: number;
  route: string;
  status: "DONE" | "INPROGRESS";
}

interface IWeekRecord {
  weekNumber: number;
  intervals: IRunEntry;
  easyRun: IRunEntry;
  longRun: IRunEntry;
  weekComplete: boolean;
}

interface IProgressRecord {
  progress: number;
  status: "DONE" | "INPROGRESS";
}

interface ICharityRecord {
  completed: boolean;
}

interface IWorkoutDay {
  dayNumber: number; // 1–4
  completed: boolean;
  scid?: Types.ObjectId;
}

interface IWorkoutWeek {
  weekNumber: number; // 1–4
  days: IWorkoutDay[];
  weekComplete: boolean;
}

interface IWorkoutChallenge {
  weeks: IWorkoutWeek[];
}

interface IReadsRecord {
  completed: boolean;
}

interface IDayRecord {
  day: number;
  meditation: IProgressRecord;
  waterIntake: IProgressRecord;
  charity: ICharityRecord;
  reads: IReadsRecord;
  dayComplete: boolean;
}

interface IRunChallenge {
  subscription: "5km" | "10km";
  weeks: IWeekRecord[];
}

export interface IChallengeRecord extends Document {
  uid: Types.ObjectId;
  runChallenge: IRunChallenge;
  workoutChallenge: IWorkoutChallenge;
  dailyChallenges: IDayRecord[];
}

interface IChallengeStatics {
  initRecord(
    uid: string,
    session: ClientSession
  ): Promise<IChallengeRecord>;

    initRun(
    uid: string,
    runSubscription: "5km" | "10km",
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  // Run Updates
  updateRun(
    uid: string,
    week: number,
    runType: "intervals" | "easyRun" | "longRun",
    data: { distance: number; pace: number; duration: number; route: string },
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  resetRun(
    uid: string,
    week: number,
    runType: "intervals" | "easyRun" | "longRun",
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  // Daily Challenge Updates
  updateMeditation(
    uid: string,
    day: number,
    progress: number,
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  updateWaterIntake(
    uid: string,
    day: number,
    progress: number,
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  updateCharity(
    uid: string,
    day: number,
    completed: boolean,
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
 initWorkout(
  uid: string,
  session: ClientSession
): Promise<IChallengeRecord>;

updateWorkoutDay(
  uid: string,
  week: number,
  dayNumber: number,
  completed: boolean,
  scid: string | undefined,
  session: ClientSession
): Promise<IChallengeRecord | null>;

resetWorkoutDay(
  uid: string,
  week: number,
  dayNumber: number,
  session: ClientSession
): Promise<IChallengeRecord>;
  
  updateReads(
    uid: string,
    day: number,
    completed: boolean,
    session: ClientSession
  ): Promise<IChallengeRecord>;
  
  // Reset Daily Challenges
  resetMeditation(uid: string, day: number, session: ClientSession): Promise<IChallengeRecord>;
  resetWaterIntake(uid: string, day: number, session: ClientSession): Promise<IChallengeRecord>;
  resetCharity(uid: string, day: number, session: ClientSession): Promise<IChallengeRecord>;
  resetWorkout(uid: string, day: number, session: ClientSession): Promise<IChallengeRecord>;
  resetReads(uid: string, day: number, session: ClientSession): Promise<IChallengeRecord>;
}

type IChallengeModel = Model<IChallengeRecord> & IChallengeStatics;

// ============= HELPER FUNCTIONS =============

function buildInitialWeeks(): IWeekRecord[] {
  return Array.from({ length: 4 }, (_, i) => ({
    weekNumber: i + 1,
    intervals: {
      distance: 0,
      pace: 0,
      duration: 0,
      route: "",
      status: "INPROGRESS" as const,
    },
    easyRun: {
      distance: 0,
      pace: 0,
      duration: 0,
      route: "",
      status: "INPROGRESS" as const,
    },
    longRun: {
      distance: 0,
      pace: 0,
      duration: 0,
      route: "",
      status: "INPROGRESS" as const,
    },
    weekComplete: false,
  }));
}

function buildInitialWorkoutWeeks(): IWorkoutWeek[] {
  return Array.from({ length: 4 }, (_, weekIndex) => ({
    weekNumber: weekIndex + 1,
    days: Array.from({ length: 4 }, (_, dayIndex) => ({
      dayNumber: dayIndex + 1,
      completed: false,
    })),
    weekComplete: false,
  }));
}

function buildInitialDays(): IDayRecord[] {
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    meditation: {
      progress: 0,
      status: "INPROGRESS" as const,
    },
    waterIntake: {
      progress: 0,
      status: "INPROGRESS" as const,
    },
    charity: {
      completed: false,
    },
    workout: {
      completed: false,
    },
    reads: {
      completed: false,
    },
    dayComplete: false,
  }));
}

// ============= SCHEMAS =============

const WorkoutDaySchema = new Schema<IWorkoutDay>(
  {
    dayNumber: { type: Number, required: true, min: 1, max: 4 },
    completed: { type: Boolean, default: false },
    scid: { type: Schema.Types.ObjectId, ref: "ScheduledClass" },
  },
  { _id: false }
);

const WorkoutWeekSchema = new Schema<IWorkoutWeek>(
  {
    weekNumber: { type: Number, required: true, min: 1, max: 4 },
    days: { type: [WorkoutDaySchema], required: true },
    weekComplete: { type: Boolean, default: false },
  },
  { _id: false }
);

const WorkoutChallengeSchema = new Schema<IWorkoutChallenge>(
  {
    weeks: { type: [WorkoutWeekSchema], required: true },
  },
  { _id: false }
);

const RunEntrySchema = new Schema<IRunEntry>(
  {
    distance: { type: Number, default: 0 },
    pace: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    route: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DONE", "INPROGRESS"],
      default: "INPROGRESS",
    },
  },
  { _id: false }
);

const WeekRecordSchema = new Schema<IWeekRecord>(
  {
    weekNumber: { type: Number, required: true, min: 1, max: 4 },
    intervals: { type: RunEntrySchema, required: true },
    easyRun: { type: RunEntrySchema, required: true },
    longRun: { type: RunEntrySchema, required: true },
    weekComplete: { type: Boolean, default: false },
  },
  { _id: false }
);

const ProgressRecordSchema = new Schema<IProgressRecord>(
  {
    progress: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["DONE", "INPROGRESS"],
      default: "INPROGRESS",
    },
  },
  { _id: false }
);

const CharityRecordSchema = new Schema<ICharityRecord>(
  {
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);


const ReadsRecordSchema = new Schema<IReadsRecord>(
  {
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);

const DayRecordSchema = new Schema<IDayRecord>(
  {
    day: { type: Number, required: true, min: 1, max: 30 },
    meditation: { type: ProgressRecordSchema, required: true },
    waterIntake: { type: ProgressRecordSchema, required: true },
    charity: { type: CharityRecordSchema, required: true },
    reads: { type: ReadsRecordSchema, required: true },
    dayComplete: { type: Boolean, default: false },
  },
  { _id: false }
);

const RunChallengeSchema = new Schema<IRunChallenge>(
  {
    subscription: {
      type: String,
      enum: ["5km", "10km"],
      required: true,
      immutable: true,
    },
    weeks: { type: [WeekRecordSchema], required: true },
  },
  { _id: false }
);

const ChallengeRecordSchema = new Schema<IChallengeRecord>({
  uid: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "User",
    unique: true,
  },
  runChallenge: { type: RunChallengeSchema, required: false },
  workoutChallenge: { type: WorkoutChallengeSchema, required: false },
  dailyChallenges: { type: [DayRecordSchema], required: true },
});

// ============= STATIC METHODS =============

// Initialize Record
ChallengeRecordSchema.statics.initRecord = async function (
  uid: string,
  session: ClientSession
): Promise<IChallengeRecord> {
  return await this.findOneAndUpdate(
    { uid },
    {
      $setOnInsert: {
        uid,
        dailyChallenges: buildInitialDays(),
      },
    },
    { upsert: true, session , new: true}
  );
};

ChallengeRecordSchema.statics.initRun = async function (
  uid: string,
  runSubscription: "5km" | "0km",
  session: ClientSession
): Promise<IChallengeRecord> {
  return await this.findOneAndUpdate(
    { uid, runChallenge: { $exists: false } },
    {
      $set: {
        runChallenge: {
          subscription: runSubscription,
          weeks: buildInitialWeeks(),
        },
      },
    },
    { new: true, session }
  );
};

ChallengeRecordSchema.statics.initWorkout = async function (
  uid: string,
  session: ClientSession
): Promise<IChallengeRecord> {
  return await this.findOneAndUpdate(
    { uid, workoutChallenge: { $exists: false } },
    {
      $set: {
        workoutChallenge: {
          weeks: buildInitialWorkoutWeeks(),
        },
      },
    },
    { new: true, session }
  );
};
// ============= RUN CHALLENGE UPDATES =============

ChallengeRecordSchema.statics.updateRun = async function (
  uid: string,
  week: number,
  runType: "intervals" | "easyRun" | "longRun",
  data: { distance: number; pace: number; duration: number; route: string },
  session: ClientSession
): Promise<IChallengeRecord | null> {
  let finalRecord: IChallengeRecord | null = null;
  const weekIndex = week - 1;
  const runPath = `runChallenge.weeks.${weekIndex}.${runType}`;

  // Update the run entry with DONE status
  finalRecord = await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`${runPath}.distance`]: data.distance,
        [`${runPath}.pace`]: data.pace,
        [`${runPath}.duration`]: data.duration,
        [`${runPath}.route`]: data.route,
        [`${runPath}.status`]: "DONE",
      },
    },
    { session, new: true }
  );

  // Check if all 3 runs in the week are DONE and update weekComplete
  if (finalRecord) {
    const weekRecord = finalRecord.runChallenge.weeks[weekIndex];
    const allRunsDone =
      weekRecord.intervals.status === "DONE" &&
      weekRecord.easyRun.status === "DONE" &&
      weekRecord.longRun.status === "DONE";

    if (allRunsDone) {
      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`runChallenge.weeks.${weekIndex}.weekComplete`]: true,
          },
        },
        { session , new: true}
      );
    }
  }
  return finalRecord;
};

ChallengeRecordSchema.statics.resetRun = async function (
  uid: string,
  week: number,
  runType: "intervals" | "easyRun" | "longRun",
  session: ClientSession
): Promise<IChallengeRecord> {
  const weekIndex = week - 1;
  const runPath = `runChallenge.weeks.${weekIndex}.${runType}`;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`${runPath}.distance`]: 0,
        [`${runPath}.pace`]: 0,
        [`${runPath}.duration`]: 0,
        [`${runPath}.route`]: "",
        [`${runPath}.status`]: "INPROGRESS",
        [`runChallenge.weeks.${weekIndex}.weekComplete`]: false,
      },
    },
    { session , new: true}
  );
};

// ============= DAILY CHALLENGE UPDATES =============

// Meditation
ChallengeRecordSchema.statics.updateMeditation = async function (
  uid: string,
  day: number,
  progress: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  let finalRecord: IChallengeRecord;
  const dayIndex = day - 1;
  const status = progress === 100 ? "DONE" : "INPROGRESS";

  finalRecord = await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.meditation.progress`]: progress,
        [`dailyChallenges.${dayIndex}.meditation.status`]: status,
      },
    },
    { session , new: true}
  );

  // Check and update dayComplete
  if (finalRecord) {
    const dayRecord = finalRecord.dailyChallenges[dayIndex];
    if (dayRecord) {
      const allComplete =
        dayRecord.meditation.status === "DONE" &&
        dayRecord.waterIntake.status === "DONE" &&
        dayRecord.charity.completed === true &&
        dayRecord.reads.completed === true;

      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`dailyChallenges.${dayIndex}.dayComplete`]: allComplete,
          },
        },
        { session , new: true}
      );
    }
  }
  return finalRecord;
};

ChallengeRecordSchema.statics.resetMeditation = async function (
  uid: string,
  day: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  const dayIndex = day - 1;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.meditation.progress`]: 0,
        [`dailyChallenges.${dayIndex}.meditation.status`]: "INPROGRESS",
        [`dailyChallenges.${dayIndex}.dayComplete`]: false,
      },
    },
    { session , new: true}
  );
};

// Water Intake
ChallengeRecordSchema.statics.updateWaterIntake = async function (
  uid: string,
  day: number,
  progress: number,
  session: ClientSession
): Promise<IChallengeRecord | null> {
  let finalRecord: IChallengeRecord | null = null; 
  const dayIndex = day - 1;
  const status = progress === 100 ? "DONE" : "INPROGRESS";

  finalRecord = await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.waterIntake.progress`]: progress,
        [`dailyChallenges.${dayIndex}.waterIntake.status`]: status,
      },
    },
    { session , new: true}
  );

  // Check and update dayComplete
  if (finalRecord) {
    const dayRecord = finalRecord.dailyChallenges[dayIndex];
    if (dayRecord) {
      const allComplete =
        dayRecord.meditation.status === "DONE" &&
        dayRecord.waterIntake.status === "DONE" &&
        dayRecord.charity.completed === true &&
        dayRecord.reads.completed === true;

      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`dailyChallenges.${dayIndex}.dayComplete`]: allComplete,
          },
        },
        { session }
      );
    }
  }
  return finalRecord;
};

ChallengeRecordSchema.statics.resetWaterIntake = async function (
  uid: string,
  day: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  const dayIndex = day - 1;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.waterIntake.progress`]: 0,
        [`dailyChallenges.${dayIndex}.waterIntake.status`]: "INPROGRESS",
        [`dailyChallenges.${dayIndex}.dayComplete`]: false,
      },
    },
    { session, new: true}
  );
};

// Charity
ChallengeRecordSchema.statics.updateCharity = async function (
  uid: string,
  day: number,
  completed: boolean,
  session: ClientSession
): Promise<IChallengeRecord | null> {
  let finalRecord: IChallengeRecord | null = null;
  const dayIndex = day - 1;

  finalRecord = await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.charity.completed`]: completed,
      },
    },
    { session, new: true }
  );

  // Check and update dayComplete
  if (finalRecord) {
    const dayRecord = finalRecord.dailyChallenges[dayIndex];
    if (dayRecord) {
      const allComplete =
        dayRecord.meditation.status === "DONE" &&
        dayRecord.waterIntake.status === "DONE" &&
        dayRecord.charity.completed === true &&
        dayRecord.reads.completed === true;

      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`dailyChallenges.${dayIndex}.dayComplete`]: allComplete,
          },
        },
        { session, new: true }
      );
    }
  }
  return finalRecord;
};

ChallengeRecordSchema.statics.resetCharity = async function (
  uid: string,
  day: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  const dayIndex = day - 1;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.charity.completed`]: false,
        [`dailyChallenges.${dayIndex}.dayComplete`]: false,
      },
    },
    { session, new: true }
  );
};

// Workout
ChallengeRecordSchema.statics.updateWorkoutDay = async function (
  uid: string,
  week: number,
  dayNumber: number,
  completed: boolean,
  scid: string | undefined,
  session: ClientSession
): Promise<IChallengeRecord | null> {
  let finalRecord: IChallengeRecord | null = null;

  const weekIndex = week - 1;
  const dayIndex = dayNumber - 1;

  const basePath = `workoutChallenge.weeks.${weekIndex}.days.${dayIndex}`;

  const updateObj: any = {
    [`${basePath}.completed`]: completed,
  };

  if (scid !== undefined) {
    updateObj[`${basePath}.scid`] = scid;
  }

  finalRecord = await this.findOneAndUpdate(
    { uid },
    { $set: updateObj },
    { session, new: true }
  );

  // Check if all 4 days are completed
  if (finalRecord) {
    const weekRecord = finalRecord.workoutChallenge?.weeks[weekIndex];

    if (weekRecord) {
      const allDone = weekRecord.days.every((d) => d.completed === true);

      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`workoutChallenge.weeks.${weekIndex}.weekComplete`]: allDone,
          },
        },
        { session, new: true }
      );
    }
  }

  return finalRecord;
};

ChallengeRecordSchema.statics.resetWorkoutDay = async function (
  uid: string,
  week: number,
  dayNumber: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  const weekIndex = week - 1;
  const dayIndex = dayNumber - 1;

  const basePath = `workoutChallenge.weeks.${weekIndex}.days.${dayIndex}`;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`${basePath}.completed`]: false,
        [`workoutChallenge.weeks.${weekIndex}.weekComplete`]: false,
      },
      $unset: {
        [`${basePath}.scid`]: "",
      },
    },
    { session, new: true }
  );
};

// Reads
ChallengeRecordSchema.statics.updateReads = async function (
  uid: string,
  day: number,
  completed: boolean,
  session: ClientSession
): Promise<IChallengeRecord | null> {
  let finalRecord: IChallengeRecord | null = null;
  const dayIndex = day - 1;

  finalRecord = await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.reads.completed`]: completed,
      },
    },
    { session, new: true }
  );

  // Check and update dayComplete
  if (finalRecord) {
    const dayRecord = finalRecord.dailyChallenges[dayIndex];
    if (dayRecord) {
      const allComplete =
        dayRecord.meditation.status === "DONE" &&
        dayRecord.waterIntake.status === "DONE" &&
        dayRecord.charity.completed === true &&
        dayRecord.reads.completed === true;

      finalRecord = await this.findOneAndUpdate(
        { uid },
        {
          $set: {
            [`dailyChallenges.${dayIndex}.dayComplete`]: allComplete,
          },
        },
        { session, new: true }
      );
    }
  }
  return finalRecord;
};

ChallengeRecordSchema.statics.resetReads = async function (
  uid: string,
  day: number,
  session: ClientSession
): Promise<IChallengeRecord> {
  const dayIndex = day - 1;

  return await this.findOneAndUpdate(
    { uid },
    {
      $set: {
        [`dailyChallenges.${dayIndex}.reads.completed`]: false,
        [`dailyChallenges.${dayIndex}.dayComplete`]: false,
      },
    },
    { session, new: true }
  );
};

// ============= MODEL EXPORT =============

const ChallengeRecord = mongoose.model<IChallengeRecord, IChallengeModel>(
  "ChallengeRecord",
  ChallengeRecordSchema
);

export default ChallengeRecord;