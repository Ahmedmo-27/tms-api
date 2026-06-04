import mongoose, {
  Document,
  Schema,
  Types,
  Model,
  ClientSession,
} from "mongoose";
import { ConflictError, NotFoundError } from "../core/ApiError";
import { Server } from "http";
import logger from "../config/logger";

interface IMemberBooking {
  uid: Types.ObjectId;
  method: string;
}

export interface IScheduledClass extends Document {
  cid: Types.ObjectId;
  startTime: Date;
  endTime: Date;
  availableSlots: number;
  bookedMembers: IMemberBooking[];
  coachId: Types.ObjectId;
  scans: IMemberScan[];
  waitingList?: string[];
}

export interface IScheduledClassMethods {
  checkBookedMember(uid: string, member: string, io: Server): Promise<boolean>;
  addMemberToWaitingList(fcmToken: string): Promise<boolean>;
}

interface IScheduledClassStatics {
  bookMember(
    scid: string,
    uid: string,
    usedPkg: string,
    session: ClientSession,
  ): Promise<void>;
  bookNonUser(scid: string, session: ClientSession): Promise<void>;
  removeBookedNonUser(
    scid: string,
    session: ClientSession,
  ): Promise<string[] | undefined>;
  removeBookedMember(
    scid: string,
    uid: string,
    session: ClientSession,
  ): Promise<string[] | undefined>;
  addMemberScan(
    scid: string,
    uid: string,
    status?: boolean,
    session?: ClientSession,
    methodOverride?: string,
  ): Promise<void>;
  removeSuccessfulMemberScan(
    scid: string,
    uid: string,
    session?: ClientSession,
  ): Promise<void>;
}

type IScheduledClassModel = Model<IScheduledClass, {}, IScheduledClassMethods> &
  IScheduledClassStatics;

interface IMemberScan {
  uid: Types.ObjectId;
  scanTime: Date;
  method: string;
  status: boolean;
}

const MemberScanSchema = new Schema({
  uid: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  scanTime: {
    type: Date,
    required: true,
  },
  method: {
    type: String,
    required: false,
  },
  status: {
    type: Boolean,
    default: true,
  },
});
// trigger redeployment
const ScheduledClassSchema = new Schema<
  IScheduledClass,
  IScheduledClassModel,
  IScheduledClassMethods
>({
  cid: {
    type: Schema.Types.ObjectId,
    ref: "Class",
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  availableSlots: {
    type: Number,
    required: true,
  },
  bookedMembers: [
    {
      uid: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      method: {
        type: String,
        required: true,
      },
    },
  ],
  coachId: {
    type: Schema.Types.ObjectId,
    ref: "Coach",
  },
  scans: [MemberScanSchema],
  waitingList: {
    type: [String],
    required: false,
  },
});

ScheduledClassSchema.static(
  "bookMember",
  async function (
    scid: string,
    uid: string,
    usedPkg: string,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.findOneAndUpdate(
      {
        _id: new Types.ObjectId(scid),
        bookedMembers: {
          $not: { $elemMatch: { uid: new Types.ObjectId(uid) } },
        },
        availableSlots: { $gt: 0 },
      },
      {
        $push: {
          bookedMembers: { uid: new Types.ObjectId(uid), method: usedPkg },
        },
        $inc: { availableSlots: -1 },
      },
      {
        new: true,
        session,
      },
    );
    if (!result)
      throw new ConflictError("CLASS_FULLY_BOOKED", "Class is fully booked");
  },
);

ScheduledClassSchema.static(
  "bookNonUser",
  async function (scid: string, session: ClientSession): Promise<void> {
    const result = await this.findOneAndUpdate(
      {
        _id: new Types.ObjectId(scid),
        availableSlots: { $gt: 0 },
      },
      {
        $inc: { availableSlots: -1 },
      },
      {
        new: true,
        session,
      },
    );
    if (!result)
      throw new ConflictError("CLASS_FULLY_BOOKED", "Class is fully booked");
  },
);

ScheduledClassSchema.static(
  "removeBookedMember",
  async function (
    scid: string,
    uid: string,
    session: ClientSession,
  ): Promise<string[] | undefined> {
    let notifyWaitingList = false;
    const scheduledClass = await this.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError(
        "CLASS_NOT_FOUND",
        "ScheduledClass was not found",
      );
    const member = scheduledClass.bookedMembers.find((m) => m.uid.equals(uid));
    if (!member)
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
    logger.info("Removing member from cls", { uid, scid });
    if (scheduledClass.availableSlots == 0) notifyWaitingList = true;
    await this.updateOne(
      {
        _id: new Types.ObjectId(scid),
        bookedMembers: { $elemMatch: { uid: new Types.ObjectId(uid) } },
      },
      {
        $pull: { bookedMembers: { uid: new Types.ObjectId(uid) } },
        $inc: { availableSlots: 1 },
      },
      { session },
    );
    if (notifyWaitingList) return scheduledClass.waitingList;
    else return [];
  },
);

ScheduledClassSchema.static(
  "removeBookedNonUser",
  async function (
    scid: string,
    session: ClientSession,
  ): Promise<string[] | undefined> {
    let notifyWaitingList = false;
    const scheduledClass = await this.findById(scid);
    if (!scheduledClass)
      throw new NotFoundError(
        "CLASS_NOT_FOUND",
        "ScheduledClass was not found",
      );
    if (scheduledClass.availableSlots == 0) notifyWaitingList = true;
    await this.updateOne(
      {
        _id: new Types.ObjectId(scid),
      },
      {
        $inc: { availableSlots: 1 },
      },
      { session },
    );
    if (notifyWaitingList) return scheduledClass.waitingList;
    else return [];
  },
);

ScheduledClassSchema.method(
  "checkBookedMember",
  async function (uid: string, member: string, io: Server): Promise<boolean> {
    const scheduledClass = this;
    const booking = scheduledClass.bookedMembers.find((memberId) =>
      memberId.uid.equals(uid),
    );
    logger.info("DATA: ", {
      uid,
      members: scheduledClass.bookedMembers,
      booking,
    });
    if (!booking) {
      io.emit("FAILED-SCAN", {
        code: "CLASS_NOT_BOOKED",
        message: "Member is not booked",
        member,
      });
      return false;
    }
    return true;
  },
);

ScheduledClassSchema.static(
  "addMemberScan",
  async function (
    scid: string,
    uid: string,
    status: boolean,
    session?: ClientSession,
    methodOverride?: string,
  ) {
    const scls = await this.findOne({
      _id: new Types.ObjectId(scid),
      bookedMembers: { $elemMatch: { uid: new Types.ObjectId(uid) } },
    });
    const booking = scls?.bookedMembers.find((b) => b.uid.equals(uid));
    const scanMethod =
      methodOverride !== undefined ? methodOverride : booking?.method;
    const result = await this.findOneAndUpdate(
      {
        _id: new Types.ObjectId(scid),
        scans: {
          $not: {
            $elemMatch: {
              uid: new Types.ObjectId(uid),
              status,
            },
          },
        },
      },
      {
        $push: {
          scans: {
            uid: new Types.ObjectId(uid),
            scanTime: new Date(),
            method: scanMethod,
            status,
          },
        },
      },
      {
        new: true,
        session,
      },
    );
    if (!result)
      throw new ConflictError(
        "CLASS_ALREADY_SCANNED",
        "User already scanned for this class",
      );
  },
);

ScheduledClassSchema.static(
  "removeSuccessfulMemberScan",
  async function (
    scid: string,
    uid: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.updateOne(
      { _id: new Types.ObjectId(scid) },
      {
        $pull: {
          scans: {
            uid: new Types.ObjectId(uid),
            status: true,
          },
        },
      },
      { session },
    );
  },
);

ScheduledClassSchema.method(
  "addMemberToWaitingList",
  async function (fcmToken: string): Promise<void> {
    const res = await this.model("ScheduledClass").updateOne(
      {
        _id: this._id,
        availableSlots: { $lte: 0 }, 
      },
      {
        $addToSet: { waitingList: fcmToken },
      },
    );

    if (res.matchedCount === 0) {
      throw new Error("Cannot join waiting list while slots are available");
    }
  },
);

const ScheduledClass = mongoose.model<IScheduledClass, IScheduledClassModel>(
  "ScheduledClass",
  ScheduledClassSchema,
);

export default ScheduledClass;
