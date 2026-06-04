import mongoose, {
  Types,
  Schema,
  Document,
  ClientSession,
  Model,
} from "mongoose";
import { NotFoundError } from "../core/ApiError";
import logger from "../config/logger";

export interface INonUserBooking extends Document {
  scid: Types.ObjectId;
  name: string;
  phoneNumber: string;
  bookingTime: Date;
  attendanceTime?: Date;
  status: "BOOKED" | "ATTENDED" | "PAID" | "CANCELLED";
  paymentId?: Types.ObjectId;
}

type NonUserBookingModel = Model<INonUserBooking> & {
  addBooking(
    name: string,
    phoneNumber: string,
    scid: string,
    session: ClientSession
  ): Promise<INonUserBooking>;
  recordAttendance(
    bookingId: string,
    session: ClientSession
  ): Promise<INonUserBooking>;
  recordPayment(
    bookingId: string,
    paymentId: string,
    session: ClientSession
  ): Promise<INonUserBooking>;
  cancelBooking(
    bookingId: string,
    session: ClientSession
  ): Promise<INonUserBooking>;
};
const NonUserBookingSchema: Schema<INonUserBooking, NonUserBookingModel> =
  new Schema({
    scid: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "ScheduledClass",
    },
    name: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      match: [
        /^\d{11}$/,
        "Please enter a valid phone number (11 digits without spaces)",
      ],
    },
    status: {
      type: String,
      enum: ["BOOKED", "ATTENDED", "PAID", "CANCELLED"],
      default: "BOOKED",
    },
    attendanceTime: {
      type: Date,
      required: false,
    },
    bookingTime: {
      type: Date,
      required: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: false,
    },
  });

NonUserBookingSchema.static(
  "addBooking",
  async function (
    scid: string,
    name: string,
    phoneNumber: string,
    session: ClientSession
  ): Promise<INonUserBooking> {
    const booking = {
      name,
      phoneNumber,
      scid,
      bookingTime: new Date(),
    };
    const newBooking = new this(booking);
    logger.info("Booking at model level: ", newBooking);
    await newBooking.save({ session });
    return newBooking.toObject();
  }
);

NonUserBookingSchema.static(
  "recordAttendance",
  async function (bookingId: string, session: ClientSession) {
    const booking = await this.findByIdAndUpdate(
      bookingId,
      { status: "ATTENDED", attendanceTime: new Date() },
      { new: true, session }
    );
    if (!booking)
      throw new NotFoundError(
        "BOOKING_NOT_FOUND",
        "Booking could not be found"
      );
    return booking;
  }
);

NonUserBookingSchema.static(
  "recordPayment",
  async function (
    bookingId: string,
    paymentId: string,
    session: ClientSession
  ) {
    const booking = await this.findByIdAndUpdate(
      bookingId,
      { status: "PAID", paymentId },
      { new: true, session }
    );
    if (!booking)
      throw new NotFoundError(
        "BOOKING_NOT_FOUND",
        "Booking could not be found"
      );
    return booking;
  }
);

NonUserBookingSchema.static(
  "cancelBooking",
  async function (bookingId: string, session: ClientSession) {
    const booking = await this.findByIdAndUpdate(
      bookingId,
      { status: "CANCELLED" },
      { new: true, session }
    );
    if (!booking)
      throw new NotFoundError(
        "BOOKING_NOT_FOUND",
        "Booking could not be found"
      );
    return booking;
  }
);

const NonUserBooking = mongoose.model<INonUserBooking, NonUserBookingModel>(
  "NonUserBooking",
  NonUserBookingSchema
);

export default NonUserBooking;
