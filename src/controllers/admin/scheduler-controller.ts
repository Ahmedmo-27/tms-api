import { Request, Response } from "express";
import Schedule from "../../models/schedule";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SchedulerService } from "../../services/scheduler-service";

export const getScheduledClasses = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const date = req.query.date;
  let scheduleData;
  if (date) {
    scheduleData = await SchedulerService.getSchedule(date as string);
  } else {
    scheduleData = await SchedulerService.getAllScheduledClasses();
  }

  new SuccessResponse("Scheduled Classes Found!", scheduleData).send(res);
});

export const getNextScheduledClasses = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scheduledClasses = await SchedulerService.getNextSchedule();
  if (!scheduledClasses || scheduledClasses.length === 0)
    throw new NotFoundError("CLASSES_NOT_FOUND", "No classes scheduled");
  new SuccessResponse("Scheduled Classes Found!", scheduledClasses).send(res);
});

export const scheduleClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { cid, startTime, endTime, availableSlots, coachId } = req.body;
  const scheduledClass = await SchedulerService.scheduleClass(
    cid,
    startTime,
    endTime,
    availableSlots,
    coachId
  );
  new SuccessResponse("Class Scheduled!", scheduledClass).send(res);
});

export const cancelClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scid = req.params.scid;
  await SchedulerService.cancelClass(scid);
  new SuccessResponse("Class Canceled!").send(res);
});

export const editClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scid = req.params.scid;
  const updatedClass = await SchedulerService.editClass(req.body, scid);
  new SuccessResponse("Class Updated!", updatedClass).send(res);
});

export const getDailyAttendnace = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const date = req.query.date as string || new Date().toISOString()
  const record = await SchedulerService.getDayAttendance(date);
  new SuccessResponse("Attendnace Fetched!", record).send(res);
});
