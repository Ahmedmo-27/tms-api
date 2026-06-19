import { Request, Response } from "express";
import Class from "../../models/class";
import Member from "../../models/member";
import ScheduledClass from "../../models/scheduledClass";
import Location from "../../models/location";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { BookingsService } from "../../services/bookings-service";
import { INonUserBooking } from "../../models/nonUserBookings";
import { Types } from "mongoose";
import { runInTransaction } from "../../utils/transaction";
import { ClientSession } from "mongoose";
import logger from "../../config/logger";

const processLocations = async (locationsRaw: any) => {
  if (locationsRaw === undefined || locationsRaw === null || locationsRaw === "") return undefined;
  const locs = Array.isArray(locationsRaw) ? locationsRaw : [locationsRaw];
  const mappedLocations = [];
  for (const loc of locs) {
    if (Types.ObjectId.isValid(loc)) {
      mappedLocations.push(loc);
    } else {
      const cleanLoc = String(loc).trim();
      const foundLoc = await Location.findOne({ 
        $or: [
          { branchName: { $regex: new RegExp(`^${cleanLoc}$`, "i") } },
          { location: { $regex: new RegExp(`^${cleanLoc}$`, "i") } }
        ]
      });
      if (foundLoc) {
        mappedLocations.push(foundLoc._id);
      } else {
        throw new BadRequestError("INVALID_LOCATION", `Location ${loc} not found`);
      }
    }
  }
  return mappedLocations;
};

export const addClass = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { title, category, price, locations, location, points, allowDropIn } = req.body;
    const finalLocationsRaw = locations !== undefined ? locations : location;
    const finalLocations = await processLocations(finalLocationsRaw) || [];
    const cls = new Class({ title, category, price, locations: finalLocations, points, allowDropIn });
    await cls.save();
    new SuccessResponse("Class Added!", cls).send(res);
  }
);

export const getClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { cid, title, category } = req.query;
  const query: any = {};
  if (cid) {
    query._id = cid;
  }
  if (title) {
    query.title = { $regex: title, $options: "i" };
  }
  if (category) {
    query.category = category;
  }
  const classes = await Class.find(query).populate("locations");
  if (!classes || classes.length === 0)
    throw new NotFoundError("CLASSES_NOT_FOUND", "Classes not found", {
      query,
    });
  
  const mappedClasses = classes.map((cls) => {
    const clsObj = cls.toObject() as any;
    const locs = clsObj.locations as any[];
    if (locs && locs.length > 0) {
      clsObj.location = locs[0].branchName || locs[0].location;
    }
    return clsObj;
  });

  new SuccessResponse("Classes Found!", mappedClasses).send(res);
});

export const updateClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const cid = req.params.cid;
  const { title, category, price, location, locations, points, allowDropIn } = req.body;
  const validUpdates = ["title", "category", "price", "location", "locations", "points", "allowDropIn"];
  const updates = Object.keys(req.body);
  const isValidUpdate = updates.every((update) =>
    validUpdates.includes(update)
  );
  if (!isValidUpdate)
    throw new BadRequestError("INVALID_UPDATES", "Invalid updates");
  const scheduledClasses = await ScheduledClass.find({ cid });
  if (scheduledClasses.length > 0) {
    throw new ConflictError(
      "HAS_SCHEDULED_CLASSES",
      "Class has scheduled classes"
    );
  }
  
  const finalLocationsRaw = locations !== undefined ? locations : location;
  const finalLocations = await processLocations(finalLocationsRaw);

  const updateData: any = { title, category, price, points, allowDropIn };
  if (finalLocations !== undefined) {
    updateData.locations = finalLocations;
  }
  Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

  const cls = await Class.findByIdAndUpdate(
    cid,
    updateData,
    { new: true }
  ).populate("locations");
  
  if (!cls)
    throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { cid });

  const clsObj = cls.toObject() as any;
  if (clsObj.locations && clsObj.locations.length > 0) {
    clsObj.location = clsObj.locations[0].branchName || clsObj.locations[0].location;
  }

  new SuccessResponse("Class Updated!", clsObj).send(res);
});

export const deleteClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const cid = req.params.cid;
  const cls = await Class.findByIdAndDelete(cid);
  const scheduledClasses = await ScheduledClass.find({ cid });
  if (scheduledClasses.length > 0) {
    throw new ConflictError(
      "HAS_SCHEDULED_CLASSES",
      "Class has scheduled classes"
    );
  }
  if (!cls) {
    throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { cid });
  }
  new SuccessResponse("Class Deleted!", cls).send(res);
});

export const getMemberBookings = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const uid = req.query.uid;
  const member = await Member.findOne({ uid });
  if (!member) {
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
  }
  new SuccessResponse("Bookings Found!", member.bookings).send(res);
});

export const bookClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  await BookingsService.addBooking(uid, scid);
  new SuccessResponse("Class Booked!").send(res);
});

export const bookDropIn = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid, paymentMethod } = req.body;
  if (!uid || !scid || !paymentMethod) {
    throw new BadRequestError("INVALID_REQUEST", "uid, scid, and paymentMethod are required");
  }
  await BookingsService.bookAdminDropIn(uid, scid, paymentMethod);
  new SuccessResponse("Drop-in Booked!").send(res);
});

export const cancelBooking = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  await BookingsService.cancelBooking(uid, scid);
  new SuccessResponse("Class cancelled").send(res);
});

// Non User Bookings
export const getNonUserBookings = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { startDate, endDate, scid } = req.body;
  const bookings = await BookingsService.getNonUserBookings(
    startDate,
    endDate,
    scid
  );
  new SuccessResponse("Fetched Bookings", bookings).send(res);
});
export const bookNonUser = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { name, phoneNumber, scid } = req.body;
  if (!name || !phoneNumber || !scid)
    throw new BadRequestError("INVALID_REQUEST", "Invalid request");
  const booking = await BookingsService.addNonUserBooking(
    name,
    phoneNumber,
    scid
  );
  new SuccessResponse("Class Booked!", booking).send(res);
});

export const recordNonUserAttendance = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const bookingId = req.body.bookingId;
  if (!bookingId || bookingId === "")
    throw new BadRequestError("INVALID_BOOKING_ID", "Booking Id is invalid");
  const booking = await BookingsService.recordNonUserAttendance(
    bookingId,
  );
  new SuccessResponse("Class Attended!").send(res);
});

export const saveNonUserPayment = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const bookingId = req.body.bookingId;
  const paymentMethod = req.body.paymentMethod;
  const amount = req.body.amount;
  const paymentDate = req.body.paymentDate;
  if (!bookingId || bookingId === "")
    throw new BadRequestError("INVALID_BOOKING_ID", "Booking Id is invalid");
  const booking = await BookingsService.recordNonUserPayment(
    bookingId,
    paymentMethod,
    amount,
    paymentDate
  );
  new SuccessResponse("Class Attended!").send(res);
});

export const addWalkIn = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { name, phoneNumber, scid, paymentMethod, amount, paymentDate } = req.body;
  if (!name || !phoneNumber || !scid)
    throw new BadRequestError("INVALID_REQUEST", "Invalid request");
  let finalBooking;
  await runInTransaction(async (session: ClientSession) => {
    const booking: INonUserBooking = await BookingsService.addNonUserBooking(
      name,
      phoneNumber,
      scid,
      session
    );
    if (!booking)
      throw new NotFoundError("INVALID_BOOKING", "Booking was not found");
    logger.info("BookingId: ", booking._id);
     finalBooking = await BookingsService.recordNonUserAttendance(
      (booking._id as string),
      session
    );
    if (paymentMethod) {
      finalBooking = await BookingsService.recordNonUserPayment(
        (booking._id as string),
        paymentMethod,
        amount,
        paymentDate,
        session
      );
    }
  });
  if(!finalBooking) throw new InternalError("INTERNAL_ERROR", "UnknownError")
  new SuccessResponse("Class Booked!", finalBooking).send(res);
});

export const cancelNonUserBooking = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const bookingId = req.params.bookingId;
  if (!bookingId || bookingId === "")
    throw new BadRequestError("INVALID_BOOKING_ID", "Booking Id is invalid");
  const booking = await BookingsService.cancelNonUserBooking(bookingId);
  new SuccessResponse("Class Cancelled!", booking).send(res);
});

export const manualRecordMemberAttendance = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  if (!uid || !scid)
    throw new BadRequestError("INVALID_REQUEST", "uid and scid are required");
  const io = req.app.get("io");
  await BookingsService.manualRecordClassAttendance(uid, scid, io);
  new SuccessResponse("Class attended (manual)").send(res);
});

export const manualRemoveMemberAttendance = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  if (!uid || !scid)
    throw new BadRequestError("INVALID_REQUEST", "uid and scid are required");
  await BookingsService.manualRemoveClassAttendance(uid, scid);
  new SuccessResponse("Attendance removed").send(res);
});

export const overrideAddToWaitlist = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  if (!uid || !scid)
    throw new BadRequestError("INVALID_REQUEST", "uid and scid are required");
  await BookingsService.adminAddToWaitlist(uid, scid);
  new SuccessResponse("Member added to waitlist").send(res);
});

export const overrideRemoveFromWaitlist = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, scid } = req.body;
  if (!uid || !scid)
    throw new BadRequestError("INVALID_REQUEST", "uid and scid are required");
  await BookingsService.adminRemoveFromWaitlist(uid, scid);
  new SuccessResponse("Member removed from waitlist").send(res);
});

export const getWaitlistedMembers = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scid = req.query.scid as string;
  if (!scid)
    throw new BadRequestError("INVALID_REQUEST", "scid is required");
  const waitlist = await BookingsService.getWaitlistedMembers(scid);
  new SuccessResponse("Waitlist fetched", waitlist).send(res);
});


