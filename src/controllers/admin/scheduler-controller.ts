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
  const userRole = (req as any).user.role;
  const userLocationId = (req as any).user.locationId;
  const queryLocationId = req.query.locationId as string;
  
  let targetLocationId = null;
  if (userRole === "branch_admin" || userRole === "fd") {
    targetLocationId = userLocationId;
  } else if (userRole === "management" && queryLocationId) {
    targetLocationId = queryLocationId;
  }

  let scheduleData;
  if (date) {
    scheduleData = await SchedulerService.getSchedule(date as string, targetLocationId);
  } else {
    scheduleData = await SchedulerService.getAllScheduledClasses(targetLocationId);
  }

  new SuccessResponse("Scheduled Classes Found!", scheduleData).send(res);
});

export const getNextScheduledClasses = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const userRole = (req as any).user.role;
  const userLocationId = (req as any).user.locationId;
  const queryLocationId = req.query.locationId as string;
  
  let targetLocationId = null;
  if (userRole === "branch_admin" || userRole === "fd") {
    targetLocationId = userLocationId;
  } else if (userRole === "management" && queryLocationId) {
    targetLocationId = queryLocationId;
  }

  const scheduledClasses = await SchedulerService.getNextSchedule(targetLocationId);
  if (!scheduledClasses || scheduledClasses.length === 0)
    throw new NotFoundError("CLASSES_NOT_FOUND", "No classes scheduled");
  new SuccessResponse("Scheduled Classes Found!", scheduledClasses).send(res);
});

export const scheduleClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { cid, startTime, endTime, availableSlots, coachId, locationId } = req.body;
  const userRole = (req as any).user.role;
  const userLocationId = (req as any).user.locationId;
  
  let targetLocationId = locationId;
  if (userRole === "branch_admin" || userRole === "fd") {
    targetLocationId = userLocationId;
  }

  if (!targetLocationId) {
    res.status(400).json({ message: "locationId is required" });
    return;
  }

  const scheduledClass = await SchedulerService.scheduleClass(
    cid,
    startTime,
    endTime,
    availableSlots,
    coachId,
    targetLocationId
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
  const { nowInCairo } = await import("../../utils/timezone");
  const date = req.query.date as string || nowInCairo().toISOString()
  const record = await SchedulerService.getDayAttendance(date);
  new SuccessResponse("Attendnace Fetched!", record).send(res);
});
