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
      uid?: mongoose.Types.ObjectId;
      guestName?: string;
      guestPhone?: string;
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
  recordOpenGymGuestAttendance(
    guestName: string,
    guestPhone: string,
    method: string,
    session: ClientSession,
    status: "SUCCESS" | "FAILED",
    io: Server
  ): Promise<void>;
  hasSuccessfulOpenGymToday(
    uid: string,
    session?: ClientSession
  ): Promise<boolean>;
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
        uid: { type: Schema.Types.ObjectId, ref: "User", required: false },
        guestName: { type: String },
        guestPhone: { type: String },
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
  "hasSuccessfulOpenGymToday",
  async function (
    uid: string,
    session?: ClientSession
  ): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);

    const count = await this.countDocuments(
      {
        date: { $gte: startOfDay, $lte: endOfDay },
        openGymAttendance: {
          $elemMatch: {
            uid: new mongoose.Types.ObjectId(uid),
            status: "SUCCESS",
          },
        },
      },
      { session },
    );
    return count > 0;
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
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);

    let day = await this.findOne(
      { date: { $gte: startOfDay, $lte: endOfDay } },
      null,
      { session },
    );
    if (!day) {
      day = new DailyAttendance({ date: startOfDay });
      await day.save({ session });
    }

    if (status === "SUCCESS") {
      const alreadyRecorded = day.openGymAttendance.some(
        (entry) =>
          entry.uid?.toString() === uid && entry.status === "SUCCESS"
      );
      if (alreadyRecorded) {
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
    }

    const attendance = await this.findOneAndUpdate(
      { _id: day._id },
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
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Class already in attendance record"
      );
    }
  }
);

DailyAttendanceSchema.static(
  "recordOpenGymGuestAttendance",
  async function (
    guestName: string,
    guestPhone: string,
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
      { date: { $gte: startOfDay, $lte: endOfDay } },
      null,
      { session },
    );
    if (!day) {
      day = new DailyAttendance({ date: startOfDay });
      await day.save({ session });
    }

    if (status === "SUCCESS") {
      const alreadyRecorded = day.openGymAttendance.some(
        (entry) =>
          entry.guestPhone === guestPhone && entry.status === "SUCCESS",
      );
      if (alreadyRecorded) {
        io.emit("FAILED-SCAN", {
          code: "ATTENDANCE_ALREADY_RECORDED",
          message: "Attendance was already recorded",
          member: guestName,
        });
        throw new ConflictError(
          "ATTENDANCE_ALREADY_RECORDED",
          "Open gym attendance already recorded today for this guest",
        );
      }
    }

    await this.findOneAndUpdate(
      { _id: day._id },
      {
        $push: {
          openGymAttendance: {
            guestName,
            guestPhone,
            method,
            time: new Date(),
            status,
          },
        },
      },
      { session, new: true },
    );
  }
);

const DailyAttendance = mongoose.model<IDailyAttendance, DailyAttendanceModel>(
  "DailyAttendance",
  DailyAttendanceSchema
);

export default DailyAttendance;
