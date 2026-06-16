import { Request, Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import Member from "../../models/member";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";

import { BookingsService } from "../../services/bookings-service";
import { SchedulerService } from "../../services/scheduler-service";
import ScheduledClass from "../../models/scheduledClass";
import Package from "../../models/package";

export const getSchedule = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const date = req.query.date;
  const scheduleData = await SchedulerService.getSchedule(date as string);
  new SuccessResponse("Scheduled Classes Found!", scheduleData).send(res);
});

export const getBookings = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  // get member
  const _id = authReq.user._id;
  const member = await Member.findOne({ uid: _id })
    .populate({
      path: "bookings.scid",
      populate: {
        path: "cid",
        model: "Class",
      },
    })
    .populate({
      path: "bookings.scid",
      populate: {
        path: "coachId",
        model: "Coach",
      },
    });
  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { _id });
  member.bookings = member.bookings.filter(
    (b) => b.scid && typeof b.scid === "object" && b.scid._id
  );
  new SuccessResponse("Bookings Found!", member.bookings).send(res);
});

export const bookClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const scid = req.params.scid;
  await BookingsService.addBooking(uid, scid);
  new SuccessResponse("Class Booked!").send(res);
});

export const bookDropIn = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { scid, merchantReferenceId, promoCode } = req.body;
  await BookingsService.bookDropIn(uid, scid, merchantReferenceId, promoCode);
  new SuccessResponse("Class Booked!").send(res);
});

export const subToWaitingList = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { fcmToken, scid } = req.body;
  await BookingsService.addMemberToWaitingList(uid, fcmToken, scid);
  new SuccessResponse("Subscribed To Waiting List!").send(res);
});

export const cancelDropIn = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const scid = req.params.scid;
  await BookingsService.cancelDropIn(uid, scid);
  new SuccessResponse("Class Canceled!").send(res);
});

export const attendClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id as string;
  const attendanceId = req.params.attendanceId;
  const io = req.app.get("io");
  if (attendanceId === "pt") {
    await BookingsService.recordPtAttendance(_id, io);
    new SuccessResponse("Class Attended!").send(res);
    return;
  }
  if (attendanceId === "opengym") {
    await BookingsService.recordOpenGymAttendance(_id, io);
    new SuccessResponse("Class Attended!").send(res);
    return;
  }
  const scheduledClass = await ScheduledClass.findById(attendanceId);
  if (scheduledClass) {
    await BookingsService.recordAttendance(_id, attendanceId, io);
    new SuccessResponse("Class Attended!").send(res);
    return;
  }
  throw new NotFoundError("INVALID_QR_CODE", "Qr code is invalid");
});

// export const attendPt = asyncHandler(async function (
//   req: Request,
//   res: Response
// ): Promise<void> {
//   const authRequest = req as AuthRequest;
//   const _id = authRequest.user._id as string;
//   const pkgId = req.params.pkgId;
//   const io = req.app.get("io");
//   await BookingsService.recordPtAttendance(_id, pkgId, io);
//   new SuccessResponse("PT Attended!").send(res);
// });

// export const attendOpenGym = asyncHandler(async function (
//   req: Request,
//   res: Response
// ): Promise<void> {
//   const authRequest = req as AuthRequest;
//   const _id = authRequest.user._id as string;
//   const pkgId = req.params.pkgId;
//   const io = req.app.get("io");
//   await BookingsService.recordOpenGymAttendance(_id, pkgId, io);
//   new SuccessResponse("Open Gym Attended!").send(res);
// });

export const cancelClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  // get member and class to cancel
  const _id = authReq.user._id as string;
  const scid = req.params.scid;
  await BookingsService.cancelBooking(_id, scid);
  new SuccessResponse("Class Canceled!").send(res);
});
