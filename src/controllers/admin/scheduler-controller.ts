import { Request, Response } from "express";
import Schedule from "../../models/schedule";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SchedulerService } from "../../services/scheduler-service";
import { resolveLocationFilter, resolveLocationIdForWrite } from "../../utils/location-scope";

const getRestrictToLocationId = (req: Request): string | null => {
  return resolveLocationFilter(req);
};

export const getScheduledClasses = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const date = req.query.date;
  const targetLocationId = resolveLocationFilter(req) ?? undefined;

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
  const targetLocationId = resolveLocationFilter(req) ?? undefined;

  const scheduledClasses = await SchedulerService.getNextSchedule(targetLocationId);
  if (!scheduledClasses || scheduledClasses.length === 0)
    throw new NotFoundError("CLASSES_NOT_FOUND", "No classes scheduled");
  new SuccessResponse("Scheduled Classes Found!", scheduledClasses).send(res);
});

export const scheduleClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { cid, startTime, endTime, availableSlots, coachId } = req.body;
  const targetLocationId = resolveLocationIdForWrite(req);

  const scheduledClass = await SchedulerService.scheduleClass(
    cid,
    startTime,
    endTime,
    availableSlots,
    coachId,
    targetLocationId,
  );
  new SuccessResponse("Class Scheduled!", scheduledClass).send(res);
});

export const cancelClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scid = req.params.scid;
  await SchedulerService.cancelClass(scid, getRestrictToLocationId(req));
  new SuccessResponse("Class Canceled!").send(res);
});

export const editClass = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const scid = req.params.scid;
  const updatedClass = await SchedulerService.editClass(
    req.body,
    scid,
    getRestrictToLocationId(req),
  );
  new SuccessResponse("Class Updated!", updatedClass).send(res);
});

export const getDailyAttendnace = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { nowInCairo } = await import("../../utils/timezone");
  const date = (req.query.date as string) || nowInCairo().toISOString();
  const targetLocationId = resolveLocationFilter(req);
  let record = await SchedulerService.getDayAttendance(date);

  if (targetLocationId && Array.isArray(record)) {
    record = record.map((doc: any) => {
      const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
      const matchesLocation = (entry: { locationId?: { toString(): string } }) =>
        !entry.locationId || entry.locationId.toString() === targetLocationId;

      plain.ptAttendance = (plain.ptAttendance || []).filter(matchesLocation);
      plain.openGymAttendance = (plain.openGymAttendance || []).filter(matchesLocation);
      return plain;
    });
  }

  new SuccessResponse("Attendnace Fetched!", record).send(res);
});
