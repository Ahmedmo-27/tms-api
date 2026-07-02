import mongoose, {
  Model,
  Schema,
  Document,
  Types,
  ClientSession,
} from "mongoose";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../core/ApiError";
import logger from "../config/logger";
import { Server } from "http";
import Package, {
  isUnlimitedSpaceAccess,
  spaceAccessPriority,
} from "./package";
import { memberPackageGrantsAccessAtLocation } from "../utils/open-gym-location";

interface IAttendance {
  scid: Types.ObjectId;
}

interface IPtAttendance {
  pkgId: Types.ObjectId;
  attendanceTime: Date;
  date: string;
}

export interface IAdjustmentRecord {
  date: Date;
  reason?: string;
  attendanceDate?: Date;
  className?: string;
  amount: number;
  type: "ADD" | "DEDUCT";
  source:
    | "BOOKING"
    | "PT_ATTENDANCE"
    | "SPACE_WALK"
    | "ADMIN"
    | "MEMBER_CANCELLATION"
    | "FRONTDESK_CANCELLATION";
}

export interface IClassRestrictionRecord {
  cid: Types.ObjectId;
  limit: Number;
  record?: [
    {
      month: String;
      remainingSessions: number;
    }
  ];
}

export interface IMemberPackageData {
  [x: string]: any;
  pkgId: Types.ObjectId;
  name: string;
  pkgStartDate: Date;
  pkgEndDate: Date;
  status: "ACTIVE" | "EXPIRED" | "DELETED" | "COMPLETED";
  remainingClasses: number;
  classRestrictionsRecord?: IClassRestrictionRecord[];
  adjustmentHistory?: IAdjustmentRecord[];
  locationId?: Types.ObjectId;
}

export interface IMemberBookings {
  scid: Types.ObjectId;
  bookingTime: Date;
  isDropIn: boolean;
  paymentId?: Types.ObjectId;
}

export interface IMember extends Document {
  uid: Types.ObjectId;
  packages: IMemberPackageData[];
  bookings: IMemberBookings[];
  attendance: IAttendance[];
  ptAttendance: IPtAttendance[];
  isActive: boolean;
}

interface IMemberstatics {
  saveBooking(
    uid: string,
    validPkgs: string[],
    scid: string,
    isFree: boolean,
    isWorkSpace: boolean,
    cid: string,
    month: string,
    points: Number,
    session: ClientSession,
    className: string,
    attendanceDate: Date
  ): Promise<void>;
  saveDropIn(
    uid: string,

    scid: string,
    paymentId: string,
    session: ClientSession
  ): Promise<void>;
  recordAttendance(
    uid: string,

    scid: string,
    session: ClientSession,
    memberName: string,
    io: Server
  ): Promise<void>;
  removeClassAttendance(
    uid: string,
    scid: string,
    session: ClientSession
  ): Promise<void>;
  recordPtAttendance(
    uid: string,
    pkgIds: string[],
    session: ClientSession,
    io: Server,
    pkgName: string
  ): Promise<string | null>;
  recordSpaceWalkAttendance(
    uid: string,
    pkgIds: string[],
    session: ClientSession,
    io: Server,
    locationId?: string
  ): Promise<"NO_ACCESS_AT_LOCATION" | string | null>;
  removeBooking(
    uid: string,
    scid: string,
    pkgIds: string[],
    isDeducted: boolean,
    session: ClientSession,
    cid?: string,
    month?: string,
    source?: "MEMBER_CANCELLATION" | "FRONTDESK_CANCELLATION",
    className?: string
  ): Promise<void>;
  removeDropIn(
    uid: string,
    scid: string,
    session: ClientSession
  ): Promise<void>;
  addPackage(
    uid: string,
    pkgId: string,
    pkgName: string,
    numberOfSessions: number,
    startDate: string,
    endDate: string,
    session: ClientSession,
    classRestrictions?: IClassRestrictionRecord[],
    locationId?: string
  ): Promise<void>;
  removePackage(
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    session: ClientSession
  ): Promise<void>;
  editPackageClasses(
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    newClasses: number
  ): Promise<void>;
  editExpiryDate(
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    newDate: string
  ): Promise<void>;
  pushAdjustmentRecord(
    uid: string,
    pkgId: string,
    pkgStartDate: Date,
    record: IAdjustmentRecord,
    session: ClientSession
  ): Promise<void>;
}

interface IMemberMethods {}

// Define Attendance Schema
const AttendanceSchema: Schema = new Schema({
  scid: {
    type: Schema.Types.ObjectId,
    ref: "ScheduledClass",
    required: true,
  },
});

const ptAttendanceSchema: Schema = new Schema({
  pkgId: {
    type: Schema.Types.ObjectId,
    ref: "Package",
    required: true,
  },
  attendanceTime: {
    type: Date,
    required: true,
  },
  date: {
    type: String,
    required: false,
  },
});

const ClassRestrictionsRecordSchema = new Schema<IClassRestrictionRecord>({
  cid: {
    type: Schema.Types.ObjectId,
    required: true,
  },
  limit: {
    type: Number,
    required: true,
  },
  record: [
    {
      month: String,
      remainingSessions: Number,
    },
  ],
});

const AdjustmentRecordSchema = new Schema<IAdjustmentRecord>({
  date:           { type: Date, required: true },
  reason:         { type: String },
  attendanceDate: { type: Date },
  className:      { type: String },
  amount:         { type: Number, required: true },
  type:           { type: String, enum: ["ADD", "DEDUCT"], required: true },
  source:         {
    type: String,
    enum: ["BOOKING", "PT_ATTENDANCE", "SPACE_WALK", "ADMIN", "MEMBER_CANCELLATION", "FRONTDESK_CANCELLATION"],
    required: true,
  },
});

// Define Package Schema
const MemberPackageSchema: Schema = new Schema({
  pkgId: {
    // refers to package in package collection
    type: Schema.Types.ObjectId,
    ref: "Package",
    required: true,
  },
  pkgStartDate: {
    type: Date,
    required: true,
  },
  pkgEndDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    required: true,
    enum: ["ACTIVE", "EXPIRED", "DELETED", "COMPLETED"],
  },
  remainingClasses: {
    type: Number,
    required: true,
  },
  classRestrictionsRecord: [ClassRestrictionsRecordSchema],
  adjustmentHistory: [AdjustmentRecordSchema],
  locationId: {
    type: Schema.Types.ObjectId,
    ref: "Location",
    default: null,
  },
});

const BookingSchema = new Schema({
  scid: {
    type: Schema.Types.ObjectId,
    ref: "ScheduledClass",
    required: true,
  },
  bookingTime: {
    type: Date,
    required: true,
  },
  isDropIn: {
    type: Boolean,
    required: true,
  },
  paymentId: {
    type: Schema.Types.ObjectId,
    ref: "Payment",
  },
});

type IMemberModel = Model<IMember, {}, IMemberMethods> & IMemberstatics;

// Define Member Schema
const MemberSchema: Schema<IMember, IMemberModel, IMemberMethods> = new Schema({
  uid: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  packages: [MemberPackageSchema],
  bookings: [BookingSchema],
  attendance: [AttendanceSchema],
  ptAttendance: [ptAttendanceSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
});

MemberSchema.index({ uid: 1 }, { unique: true });

MemberSchema.static(
  "saveDropIn",
  async function (
    uid: string,
    scid: string,
    paymentId: string,
    session: ClientSession
  ): Promise<void> {
    const member = await this.findOne({ uid }).session(session);
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    const booking = member.bookings.find((b) => b.scid.toString() === scid);
    if (booking)
      throw new ConflictError(
        "CLASS_ALREADY_BOOKED",
        "This class is already booked"
      );
    await this.updateOne(
      {
        uid,
        "bookings.scid": { $ne: new Types.ObjectId(scid) },
      },
      {
        $push: {
          bookings: {
            scid: new Types.ObjectId(scid),
            bookingTime: new Date(),
            isDropIn: true,
            paymentId: new Types.ObjectId(paymentId),
          },
        },
      },
      {
        session,
      }
    );
  }
);

MemberSchema.static(
  "saveBooking",
  async function (
    uid: string,
    pkgs: string[],
    scid: string,
    isFree: boolean,
    isWorkSpace: boolean,
    cid: string,
    month: string,
    points: Number,
    session: ClientSession,
    className: string,
    attendanceDate: Date
  ): Promise<string> {
    logger.info("DATA: ", {
      uid,
      pkgs,
      scid,
      isFree,
    });
    const member = await this.findOne({ uid }).session(session);
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    }

    const booking = member.bookings.find((b) => b.scid.toString() === scid);

    if (booking)
      throw new ConflictError(
        "CLASS_ALREADY_BOOKED",
        "This class is already booked"
      );

    const memberPkgs = member.packages.filter(
      (p) => pkgs.includes(p.pkgId.toString()) && p.status === "ACTIVE"
    );
    if (memberPkgs.length <= 0) {
      throw new ForbiddenError(
        "NO_ACTIVE_PACKAGE_FOUND",
        "No active packages found"
      );
    }
    memberPkgs.sort(
      (a, b) => a.pkgStartDate.getTime() - b.pkgStartDate.getTime()
    );

    logger.info("Sorted Pkgs", { memberPkgs });
    for (const pkg of memberPkgs) {
      logger.info("Trying pkg", { pkg });

      if (pkg.pkgEndDate < new Date()) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "EXPIRED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
          }
          // Session is removed to presist package status change even though booking failed
        );
        continue;
      }

      if (pkg.remainingClasses <= 0) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "COMPLETED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
            session, // We need the session to revert changes if booking succeeds
          }
        );
        continue;
      }

      // check if the package has class restrictions
      let restricted = false;
      let deductedRestriction = false;
      if (pkg.classRestrictionsRecord) {
        pkg.classRestrictionsRecord.forEach((res) => {
          if (res.cid.toString() === cid) {
            res.record?.forEach((rec) => {
              if (rec.month === month) {
                if (rec.remainingSessions === 0) {
                  restricted = true;
                } else {
                  deductedRestriction = true;
                }
              }
            });
          }
        });
      }
      if (restricted) continue;

      if (!isFree && !isWorkSpace) {
        await this.updateOne(
          {
            uid,
            "bookings.scid": { $ne: new Types.ObjectId(scid) },
          },
          {
            $push: {
              bookings: {
                scid: new Types.ObjectId(scid),
                bookingTime: new Date(),
                isDropIn: false,
              },
            },
            $inc: { "packages.$[pkg].remainingClasses": -points },
          },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
                "pkg.status": "ACTIVE",
                "pkg.pkgEndDate": { $gte: new Date() },
                "pkg.remainingClasses": { $gte: points },
              },
            ],
            session,
          }
        );
      } else {
        await this.updateOne(
          {
            uid,
            "bookings.scid": { $ne: new Types.ObjectId(scid) },
          },
          {
            $push: {
              bookings: {
                scid: new Types.ObjectId(scid),
                bookingTime: new Date(),
                isDropIn: false,
              },
            },
          },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
                "pkg.status": "ACTIVE",
                "pkg.pkgEndDate": { $gte: new Date() },
                "pkg.remainingClasses": { $gt: 0 },
              },
            ],
            session,
          }
        );
      }
      // deduct class from restriction record
      if (deductedRestriction) {
        // Decrement existing month record
        const res = await this.findOneAndUpdate(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
            "packages.classRestrictionsRecord.cid": new Types.ObjectId(cid),
            "packages.classRestrictionsRecord.record.month": month,
          },
          {
            $inc: {
              "packages.$[pkg].classRestrictionsRecord.$[restriction].record.$[monthRecord].remainingSessions":
                -1,
            },
          },
          {
            arrayFilters: [
              { "pkg.pkgId": new Types.ObjectId(pkg.pkgId) },
              { "restriction.cid": new Types.ObjectId(cid) },
              { "monthRecord.month": month },
            ],
            session,
            new: true,
          }
        );
      } else if (pkg.classRestrictionsRecord && !restricted) {
        // Initialize new month record if restriction exists but no record for this month

        const restriction = pkg.classRestrictionsRecord.find(
          (r: any) => r.cid.toString() === cid
        );
        if (restriction) {
          const tpkg = await this.findOneAndUpdate(
            {
              uid,
              "packages.pkgId": pkg.pkgId,
              "packages.pkgStartDate": new Date(pkg.pkgStartDate),
              "packages.classRestrictionsRecord.cid": new Types.ObjectId(cid),
            },
            {
              $push: {
                "packages.$[pkg].classRestrictionsRecord.$[restriction].record":
                  {
                    month: month,
                    remainingSessions: Number(restriction.limit) - 1,
                  },
              },
            },
            {
              arrayFilters: [
                { "pkg.pkgId": new Types.ObjectId(pkg.pkgId) },
                { "restriction.cid": new Types.ObjectId(cid) },
              ],
              session,
              new: true,
            }
          );
        }
      }

      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkg.pkgId),
              remainingClasses: 0,
            },
          },
        },
        {
          $set: {
            "packages.$[pkg].status": "COMPLETED",
          },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
              "pkg.remainingClasses": 0,
            },
          ],
          session,
        }
      );

      if (!isFree && !isWorkSpace) {
        const deductReason =
          Number(points) > 1
            ? `Booked class: ${className} (${points} credits)`
            : `Booked class: ${className}`;
        await this.pushAdjustmentRecord(
          uid,
          pkg.pkgId.toString(),
          pkg.pkgStartDate,
          {
            date: new Date(),
            source: "BOOKING",
            type: "DEDUCT",
            amount: Number(points),
            className,
            attendanceDate,
            reason: deductReason,
          },
          session
        );
      }

      return pkg.pkgId.toString();
    }
    throw new ForbiddenError(
      "NO_ACTIVE_PACKAGE_FOUND",
      "No active packages found"
    );
  }
);

MemberSchema.static(
  "removeBooking",
  async function (
    uid: string,
    scid: string,
    pkgIds: string[],
    isDeducted: boolean,
    session: ClientSession,
    cid?: string,
    month?: string,
    source: "MEMBER_CANCELLATION" | "FRONTDESK_CANCELLATION" = "MEMBER_CANCELLATION",
    className?: string
  ): Promise<void> {
    logger.info("Removing booking from member", {
      uid,
    });
    if (isDeducted) {
      // Validate pkgIds before processing
      if (!pkgIds || !Array.isArray(pkgIds) || pkgIds.length === 0) {
        // Still remove the booking even if pkgIds is invalid
        await this.updateOne(
          {
            uid,
            "bookings.scid": { $eq: new Types.ObjectId(scid) },
          },
          {
            $pull: { bookings: { scid: new Types.ObjectId(scid) } },
          },
          {
            session,
          }
        );
        return;
      }

      // Filter out invalid ObjectIds
      const validPkgIds = pkgIds.filter((id) => {
        if (!id || typeof id !== "string") return false;
        try {
          new Types.ObjectId(id);
          return true;
        } catch (error) {
          return false;
        }
      });

      if (validPkgIds.length === 0) {
        // Still remove the booking even if no valid pkgIds
        await this.updateOne(
          {
            uid,
            "bookings.scid": { $eq: new Types.ObjectId(scid) },
          },
          {
            $pull: { bookings: { scid: new Types.ObjectId(scid) } },
          },
          {
            session,
          }
        );
        return;
      }

      const member = await this.findOneAndUpdate(
        {
          uid,
          "bookings.scid": { $eq: new Types.ObjectId(scid) },
        },
        {
          $pull: { bookings: { scid: new Types.ObjectId(scid) } },
          $inc: { "packages.$[pkg].remainingClasses": 1 },
          $set: { "packages.$[pkg].status": "ACTIVE" },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": {
                $in: validPkgIds.map((id) => new Types.ObjectId(id)),
              },
            },
          ],
          session,
          new: true,
        }
      );
      // Push a cancellation refund record on each affected package
      if (member) {
        for (const pkgId of validPkgIds) {
          const pkg = member.packages.find(
            (p) => p.pkgId.toString() === pkgId
          );
          if (pkg) {
            const cancellationLabel =
              source === "FRONTDESK_CANCELLATION"
                ? "Front-desk cancellation"
                : "Member cancellation";
            const refundReason = className
              ? `${cancellationLabel}: ${className}`
              : cancellationLabel;
            await this.pushAdjustmentRecord(
              uid,
              pkgId,
              pkg.pkgStartDate,
              {
                date: new Date(),
                source,
                type: "ADD",
                amount: 1,
                reason: refundReason,
                className,
              },
              session
            );
          }
        }
      }

      // Check if a restriction exists and refund the class on the monthly record
      // RESTRICTIONS ARE REFUNDED TO ACTIVE PACKAGES ONLY TO PREVENT BYPASSING MONTHLY LIMITS
      let updatedRestriction = false;
      member?.packages.forEach((pkg) => {
        if (pkg.status === "ACTIVE") {
          pkg.classRestrictionsRecord?.forEach((cls) => {
            if (cls.cid.toString() === cid) {
              cls.record?.forEach((m) => {
                if (m.month === month) {
                  m.remainingSessions += 1;
                  updatedRestriction = true;
                }
              });
            }
          });
        }
      });
      if (updatedRestriction) await member?.save({ session });
    } else {
      await this.updateOne(
        {
          uid,
          "bookings.scid": { $eq: new Types.ObjectId(scid) },
        },
        {
          $pull: { bookings: { scid: new Types.ObjectId(scid) } },
        },
        {
          session,
        }
      );
    }
  }
);

MemberSchema.static(
  "removeDropIn",
  async function (
    uid: string,
    scid: string,
    session: ClientSession
  ): Promise<void> {
    await this.updateOne(
      {
        uid,
        "bookings.scid": { $eq: scid },
      },
      {
        $pull: {
          bookings: {
            scid: new Types.ObjectId(scid),
          },
        },
      },
      {
        session,
      }
    );
  }
);

MemberSchema.static(
  "recordAttendance",
  async function (
    uid: string,
    scid: string,
    session: ClientSession,
    memberName: string,
    io: Server
  ): Promise<void> {
    const member = await this.findOneAndUpdate(
      {
        uid,
        attendance: {
          $not: {
            $elemMatch: { scid: new Types.ObjectId(scid) },
          },
        },
      },
      {
        $push: {
          attendance: {
            scid: new Types.ObjectId(scid),
          },
        },
      },
      {
        session,
        new: true,
      }
    );
    if (!member) {
      io.emit("FAILED-SCAN", {
        code: "ATTENDANCE_ALREADY_RECORDED",
        message: "Attendance was already recorded",
        member: memberName,
      });
      throw new ConflictError(
        "ATTENDANCE_ALREADY_RECORDED",
        "Class already in attendance record"
      );
    }
  }
);

MemberSchema.static(
  "removeClassAttendance",
  async function (
    uid: string,
    scid: string,
    session: ClientSession
  ): Promise<void> {
    const res = await this.updateOne(
      {
        uid,
        attendance: { $elemMatch: { scid: new Types.ObjectId(scid) } },
      },
      {
        $pull: { attendance: { scid: new Types.ObjectId(scid) } },
      },
      { session }
    );
    if (res.matchedCount === 0) {
      throw new NotFoundError(
        "ATTENDANCE_NOT_FOUND",
        "No attendance recorded for this class"
      );
    }
  }
);

MemberSchema.static(
  "recordPtAttendance",
  async function (
    uid: string,
    pkgIds: string[],
    session: ClientSession,
    io: Server,
    pkgName: string
  ): Promise<string | null> {
    const today = new Date().toISOString().split("T")[0];

    const member = await this.findOne({ uid })
      .populate({ path: "uid" })
      .session(session);

    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");

    const memberPkgs = member.packages.filter(
      (p) => pkgIds.includes(p.pkgId.toString()) && p.status === "ACTIVE"
    );

    if (memberPkgs.length <= 0) {
      throw new ForbiddenError(
        "NO_ACTIVE_PACKAGE_FOUND",
        "No active packages found"
      );
    }

    memberPkgs.sort(
      (a, b) => a.pkgStartDate.getTime() - b.pkgStartDate.getTime()
    );

    for (const pkg of memberPkgs) {
      if (pkg.pkgEndDate < new Date()) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "EXPIRED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
          }
        );
        continue;
      }

      if (pkg.remainingClasses <= 0) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "COMPLETED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
            session,
          }
        );
        continue;
      }

      // 🧠 Step 1 — Prevent duplicate attendance for same day + pkgId
      const alreadyAttended = await this.exists({
        uid,
        ptAttendance: {
          $elemMatch: {
            pkgId: pkg.pkgId,
            date: today,
          },
        },
      }).session(session);

      if (alreadyAttended) {
        logger.info(
          `Duplicate attendance ignored for ${uid}, pkg ${pkg.pkgId}`
        );
        return null;
      }

      // 🧩 Step 2 — Record attendance atomically
      const res = await this.updateOne(
        {
          uid,
        },
        {
          $addToSet: {
            ptAttendance: {
              pkgId: pkg.pkgId,
              date: today,
              attendanceTime: new Date(),
            },
          },
          $inc: { "packages.$[pkg].remainingClasses": -1 },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
              "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              "pkg.status": "ACTIVE",
              "pkg.remainingClasses": { $gt: 0 },
              "pkg.pkgEndDate": { $gte: new Date() },
            },
          ],
          session,
        }
      );

      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkg.pkgId),
              remainingClasses: 0,
            },
          },
        },
        {
          $set: { "packages.$[pkg].status": "COMPLETED" },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
              "pkg.remainingClasses": 0,
            },
          ],
          session,
        }
      );

      await this.pushAdjustmentRecord(
        uid,
        pkg.pkgId.toString(),
        pkg.pkgStartDate,
        {
          date: new Date(),
          source: "PT_ATTENDANCE",
          type: "DEDUCT",
          amount: 1,
          className: pkgName,
          attendanceDate: new Date(),
          reason: `PT attendance: ${pkgName}`,
        },
        session
      );

      return pkg.pkgId.toString();
    }

    io.emit("FAILED-SCAN", {
      code: "NO_ACTIVE_PACKAGE_FOUND",
      message: "No active package found!",
      member: (member.uid as any).name,
    });
    return null;
  }
);

MemberSchema.static(
  "recordSpaceWalkAttendance",
  async function (
    uid: string,
    pkgIds: string[],
    session: ClientSession,
    io: Server,
    locationId?: string
  ): Promise<"NO_ACCESS_AT_LOCATION" | string | null> {
    const member = await this.findOne({ uid })
      .populate({ path: "uid" })
      .session(session);

    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");

    let memberPkgs = member.packages.filter(
      (p) => pkgIds.includes(p.pkgId.toString()) && p.status === "ACTIVE"
    );

    if (memberPkgs.length <= 0) {
      io.emit("FAILED-SCAN", {
        code: "NO_ACTIVE_PACKAGE_FOUND",
        message: "No active package found!",
        member: (member.uid as any).name,
      });
      return null;
    }

    const catalogPkgs = await Package.find({
      _id: { $in: memberPkgs.map((p) => p.pkgId) },
    }).session(session);
    const catalogByPkgId = new Map(
      catalogPkgs.map((p) => [p._id.toString(), p]),
    );

    if (locationId) {
      const branchEligible = memberPkgs.filter((memberPkg) => {
        const catalogPkg = catalogByPkgId.get(memberPkg.pkgId.toString());
        return memberPackageGrantsAccessAtLocation(
          memberPkg.locationId,
          catalogPkg?.locationId,
          locationId,
        );
      });

      if (branchEligible.length === 0) {
        io.emit("FAILED-SCAN", {
          code: "NO_ACCESS_AT_LOCATION",
          message: "Member does not have access at this location",
          member: (member.uid as any).name,
        });
        return "NO_ACCESS_AT_LOCATION";
      }

      memberPkgs = branchEligible;
    }

    const categoryByPkgId = new Map(
      catalogPkgs.map((p) => [p._id.toString(), p.category]),
    );

    memberPkgs.sort((a, b) => {
      const catA = categoryByPkgId.get(a.pkgId.toString()) ?? "";
      const catB = categoryByPkgId.get(b.pkgId.toString()) ?? "";
      const priorityDiff = spaceAccessPriority(catA) - spaceAccessPriority(catB);
      if (priorityDiff !== 0) return priorityDiff;
      return a.pkgStartDate.getTime() - b.pkgStartDate.getTime();
    });

    for (const pkg of memberPkgs) {
      const category = categoryByPkgId.get(pkg.pkgId.toString()) ?? "";
      const unlimitedAccess = isUnlimitedSpaceAccess(category);

      if (pkg.pkgEndDate < new Date()) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "EXPIRED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
            session,
          }
        );
        continue;
      }

      if (!unlimitedAccess && pkg.remainingClasses <= 0) {
        await this.updateOne(
          {
            uid,
            "packages.pkgId": pkg.pkgId,
            "packages.pkgStartDate": new Date(pkg.pkgStartDate),
          },
          { $set: { "packages.$[pkg].status": "COMPLETED" } },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
              },
            ],
            session,
          }
        );
        continue;
      }

      if (!unlimitedAccess) {
        await this.updateOne(
          { uid },
          {
            $inc: { "packages.$[pkg].remainingClasses": -1 },
          },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.pkgStartDate": new Date(pkg.pkgStartDate),
                "pkg.status": "ACTIVE",
                "pkg.remainingClasses": { $gt: 0 },
                "pkg.pkgEndDate": { $gte: new Date() },
              },
            ],
            session,
          }
        );

        await this.updateOne(
          {
            uid,
            packages: {
              $elemMatch: {
                pkgId: new Types.ObjectId(pkg.pkgId),
                remainingClasses: 0,
              },
            },
          },
          {
            $set: { "packages.$[pkg].status": "COMPLETED" },
          },
          {
            arrayFilters: [
              {
                "pkg.pkgId": new Types.ObjectId(pkg.pkgId),
                "pkg.remainingClasses": 0,
              },
            ],
            session,
          }
        );
      }

      const visitReason =
        category === "OPEN_GYM"
          ? "Open gym visit"
          : unlimitedAccess
            ? "Space walk-in (unlimited)"
            : "Space walk-in";

      await this.pushAdjustmentRecord(
        uid,
        pkg.pkgId.toString(),
        pkg.pkgStartDate,
        {
          date: new Date(),
          source: "SPACE_WALK",
          type: "DEDUCT",
          amount: unlimitedAccess ? 0 : 1,
          reason: visitReason,
          attendanceDate: new Date(),
        },
        session
      );

      return pkg.pkgId.toString();
    }

    io.emit("FAILED-SCAN", {
      code: "NO_ACTIVE_PACKAGE_FOUND",
      message: "No active package found!",
      member: (member.uid as any).name,
    });
    return null;
  }
);

MemberSchema.static(
  "addPackage",
  async function (
    uid: string,
    pkgId: string,
    pkgName: string,
    numberOfSessions: number,
    startDate: string,
    endDate: string,
    session: ClientSession,
    classRestrictions?: IClassRestrictionRecord[],
    locationId?: string
  ): Promise<void> {
    const { startOfDateCairo } = await import("../utils/timezone");
    const pkgStartDay = startOfDateCairo(startDate);
    const pkgStartDayEnd = new Date(pkgStartDay);
    pkgStartDayEnd.setDate(pkgStartDayEnd.getDate() + 1);
    const result = await this.findOneAndUpdate(
      {
        uid,
        packages: {
          $not: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkgId),
              pkgStartDate: { $gte: pkgStartDay, $lt: pkgStartDayEnd },
            },
          },
        },
      },
      {
        $push: {
          packages: {
            pkgId: new Types.ObjectId(pkgId),
            name: pkgName,
            pkgStartDate: new Date(startDate),
            pkgEndDate: new Date(endDate),
            status: "ACTIVE",
            remainingClasses: numberOfSessions,
            classRestrictionsRecord: classRestrictions,
            locationId: locationId ? new Types.ObjectId(locationId) : null,
          },
        },
      },
      { ...(session ? { session } : {}), new: true }
    );
    if (!result) {
      throw new ConflictError("PACKAGE_ALREADY_ADDED", "Package already added");
    }
  }
);

MemberSchema.static(
  "removePackage",
  async function (
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    session: ClientSession
  ): Promise<void> {
    // Unused variables removed
    await this.updateOne(
      {
        uid,
        packages: {
          $elemMatch: {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: new Date(pkgStartDate),
          },
        },
      },
      {
        $set: {
          "packages.$[pkg].status": "DELETED",
        },
      },
      {
        arrayFilters: [
          {
            "pkg.pkgId": new Types.ObjectId(pkgId),
            "pkg.pkgStartDate": new Date(pkgStartDate),
          },
        ],
        session,
      }
    );
  }
);

MemberSchema.static(
  "editPackageClasses",
  async function (
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    newClasses: number
  ): Promise<void> {
    logger.info("Data", { pkgId, pkgStartDate });
    const member = await this.findOne({ uid });
    if (!member) throw new NotFoundError("ERROR");
    const p = member.packages.find((p) => {
      return (
        p.pkgId.toString() === pkgId &&
        p.pkgStartDate.toDateString() === new Date(pkgStartDate).toDateString()
      );
    });
    logger.info("Package Matched", p);
    if (newClasses < 0)
      throw new BadRequestError(
        "INVALID_CLASSES_NUMBER",
        "Invalid classes number"
      );
    if (newClasses <= 0) {
      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkgId),
              pkgStartDate: new Date(pkgStartDate),
            },
          },
        },
        {
          $set: {
            "packages.$[pkg].remainingClasses": newClasses,
            "packages.$[pkg].status": "COMPLETED",
          },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkgId),
              "pkg.pkgStartDate": new Date(pkgStartDate),
            },
          ],
        }
      );
    } else {
      logger.info("Changing status to active", { newClasses });
      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkgId),
              pkgStartDate: new Date(pkgStartDate),
            },
          },
        },
        {
          $set: {
            "packages.$[pkg].remainingClasses": newClasses,
            "packages.$[pkg].status": "ACTIVE",
          },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkgId),
              "pkg.pkgStartDate": new Date(pkgStartDate),
            },
          ],
        }
      );
    }
  }
);

MemberSchema.static(
  "editExpiryDate",
  async function (
    uid: string,
    pkgId: string,
    pkgStartDate: string,
    newDate: string,
    session: ClientSession
  ): Promise<void> {
    logger.info("Data", { pkgId, pkgStartDate });
    const member = await this.findOne({ uid });
    if (!member) throw new NotFoundError("ERROR");
    const p = member.packages.find((p) => {
      return (
        p.pkgId.toString() === pkgId &&
        p.pkgStartDate.toDateString() === new Date(pkgStartDate).toDateString()
      );
    });
    logger.info("Package Matched", p);
    if (new Date(newDate) < new Date()) {
      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkgId),
              pkgStartDate: new Date(pkgStartDate),
            },
          },
        },
        {
          $set: {
            "packages.$[pkg].pkgEndDate": new Date(newDate),
            "packages.$[pkg].status": "EXPIRED",
          },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkgId),
              "pkg.pkgStartDate": new Date(pkgStartDate),
            },
          ],
          session,
        }
      );
    } else {
      await this.updateOne(
        {
          uid,
          packages: {
            $elemMatch: {
              pkgId: new Types.ObjectId(pkgId),
              pkgStartDate: new Date(pkgStartDate),
            },
          },
        },
        {
          $set: {
            "packages.$[pkg].pkgEndDate": new Date(newDate),
            "packages.$[pkg].status": "ACTIVE",
          },
        },
        {
          arrayFilters: [
            {
              "pkg.pkgId": new Types.ObjectId(pkgId),
              "pkg.pkgStartDate": new Date(pkgStartDate),
            },
          ],
          session,
        }
      );
    }
  }
);

MemberSchema.static(
  "pushAdjustmentRecord",
  async function (
    uid: string,
    pkgId: string,
    pkgStartDate: Date,
    record: IAdjustmentRecord,
    session: ClientSession
  ): Promise<void> {
    await this.updateOne(
      { uid },
      {
        $push: {
          "packages.$[pkg].adjustmentHistory": record,
        },
      },
      {
        arrayFilters: [
          {
            "pkg.pkgId": new Types.ObjectId(pkgId),
            "pkg.pkgStartDate": pkgStartDate,
          },
        ],
        session,
      }
    );
  }
);

const Member = mongoose.model<IMember, IMemberModel>("Member", MemberSchema);

export default Member;
