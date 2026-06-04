import mongoose, { Document, Schema, ClientSession, Model } from "mongoose";
import { ConflictError } from "../core/ApiError";
import { Server } from "http";

export interface IDailyAttendance extends Document {
  date: Date;
  ptAttendance: [
    {
      uid: mongoose.Types.ObjectId;
      time: Date;
      method: string;
      status: "SUCCESS" | "FAILED";
    }
  ];
  openGymAttendance: [
    {
      uid: mongoose.Types.ObjectId;
      time: Date;
      method: string;
      status: "SUCCESS" | "FAILED";
    }
  ];
}

type DailyAttendanceModel = Model<IDailyAttendance> & {
  recordPtAttendance(
    uid: string,
    method: string,
    session: ClientSession,
    status: "SUCCESS" | "FAILED",
    io: Server
  ): Promise<void>;
  recordOpenGymAttendance(
    uid: string,
    method: string,
    session: ClientSession,
    status: "SUCCESS" | "FAILED",
    io: Server
  ): Promise<void>;
};

const DailyAttendanceSchema: Schema<IDailyAttendance, DailyAttendanceModel> =
  new Schema({
    date: {
      type: Date,
      required: true,
    },
    ptAttendance: [
      {
        uid: { type: Schema.Types.ObjectId, required: true, ref: "User" },
        time: { type: Date, required: true },
        method: { type: String, required: true },
        status: { type: String, enum: ["SUCCESS", "FAILED"], default: "SUCCESS" },
      },
    ],
    openGymAttendance: [
      {
        uid: { type: Schema.Types.ObjectId, required: true, ref: "User" },
        time: { type: Date, required: true },
        method: { type: String, required: true },
        status: { type: String, enum: ["SUCCESS", "FAILED"], default: "SUCCESS" },
      },
    ],
  });

DailyAttendanceSchema.static(
  "recordPtAttendance",
  async function (
    uid: string,
    method: string,
    session: ClientSession,
    status: "SUCCESS" | "FAILED",
    io: Server
  ): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);

    let day = await this.findOne(
      {
        date: startOfDay,
      },
      null,
      { session }
    );
    if (!day) {
      day = new DailyAttendance({ date: startOfDay });
      await day.save({ session });
    }
    // add status and save attendance
    const attendance = await this.findOneAndUpdate(
      {
        _id: day._id,
      },
      {
        $push: {
          ptAttendance: {
            uid: new mongoose.Types.ObjectId(uid),
            method,
            time: new Date(),
            status,
          },
        },
      },
      {
        session,
        new: true,
      }
    );
    if (!attendance) {
      io.emit("FAILED-SCAN", {
        code: "ATTENDANCE_ALREADY_RECORDED",
        message: "Attendance was already recorded",
        member: "",
      });
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Class already in attendance record"
      );
    }
    await attendance.save({ session });
  }
);

DailyAttendanceSchema.static(
  "recordOpenGymAttendance",
  async function (
    uid: string,
    method: string,
    session: ClientSession,
    status: "SUCCESS" | "FAILED",
    io: Server
  ): Promise<void> {
    const today = new Date().setUTCHours(0, 0, 0, 0);
    const day = await this.findOne({ date: today });
    if (!day) {
      const newDay = new DailyAttendance({ date: today });
      await newDay.save();
    }
    // add status and save attendance
    const attendance = await this.findOneAndUpdate(
      {
        date: today,
        openGymAttendance: {
          $not: {
            $elemMatch: { uid: new mongoose.Types.ObjectId(uid) },
          },
        },
      },
      {
        $push: {
          openGymAttendance: {
            uid: new mongoose.Types.ObjectId(uid),
            method,
            time: new Date(),
            status,
          },
        },
      },
      {
        session,
        new: true,
      }
    );
    if (!attendance) {
      io.emit("FAILED-SCAN", {
        code: "ATTENDANCE_ALREADY_RECORDED",
        message: "Attendance was already recorded",
        member: "",
      });
      // send failed status
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Class already in attendance record"
      );
    }
  }
);

const DailyAttendance = mongoose.model<IDailyAttendance, DailyAttendanceModel>(
  "DailyAttendance",
  DailyAttendanceSchema
);

export default DailyAttendance;
