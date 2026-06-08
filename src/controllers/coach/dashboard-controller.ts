import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { CoachService } from "../../services/coach-service";
import { CoachAuthRequest } from "../../middlewares/coach.middleware";
import { DeductSessionRequestDto } from "../../dtos/coach.dto";
import { startOfWeek } from "date-fns";
import { BadRequestError } from "../../core/ApiError";

/**
 * GET /api/coach/clients
 * Returns the deduplicated list of members linked to the authenticated coach
 * via ScheduledClass documents.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export const getClients = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const { page, limit, search, filter, type } = req.query;
  
  const options = {
    page: page ? parseInt(page as string, 10) : 1,
    limit: limit ? parseInt(limit as string, 10) : 10,
    search: search as string | undefined,
    filter: filter as string | undefined,
    type: type as string | undefined,
  };

  const paginatedClients = await CoachService.getClients(coachReq.coachDocId, options);
  return new SuccessResponse("Clients found", paginatedClients).send(res);
});

/**
 * GET /api/coach/clients/:memberId/packages
 * Returns the PT packages for a specific member that are assigned to the
 * authenticated coach.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
export const getMemberPackages = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const packages = await CoachService.getMemberPackages(coachReq.coachDocId, req.params.memberId);
  const message = packages.length > 0 ? "Packages found" : "No packages found";
  return new SuccessResponse(message, { packages }).send(res);
});

/**
 * POST /api/coach/deduct
 * Deducts one session from the specified member's package and creates an
 * audit DeductionLog record.
 *
 * Requirements: 7.1, 7.2
 */
export const deductSession = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const result = await CoachService.deductSession(coachReq.coachDocId, req.body as DeductSessionRequestDto);
  return new SuccessResponse("Session deducted", { package: result }).send(res);
});

export const getSchedule = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  
  let weekStart: Date;
  if (req.query.weekStart) {
    weekStart = new Date(req.query.weekStart as string);
    if (isNaN(weekStart.getTime())) {
      throw new BadRequestError("INVALID_DATE", "Invalid weekStart date provided");
    }
  } else {
    weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  }

  const schedule = await CoachService.getSchedule(coachReq.coachDocId, weekStart);
  return new SuccessResponse("Schedule fetched", schedule).send(res);
});

/**
 * GET /api/coach/scans?date=YYYY-MM-DD
 * Returns the authenticated coach's scheduled classes for the given day,
 * each with its scan/check-in data.
 */
export const getScans = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;

  let date: Date;
  if (req.query.date) {
    date = new Date(req.query.date as string);
    if (isNaN(date.getTime())) {
      throw new BadRequestError("INVALID_DATE", "Invalid date provided. Expected YYYY-MM-DD.");
    }
  } else {
    date = new Date();
  }

  const scans = await CoachService.getScans(coachReq.coachDocId, date);
  return new SuccessResponse("Scans fetched", scans).send(res);
});

/**
 * GET /api/coach/pt-attendance?date=YYYY-MM-DD
 * Returns the PT daily attendance entries for the given date that are linked
 * to the authenticated coach via their PT package names.
 */
export const getPtAttendance = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;

  let date: Date;
  if (req.query.date) {
    date = new Date(req.query.date as string);
    if (isNaN(date.getTime())) {
      throw new BadRequestError("INVALID_DATE", "Invalid date provided. Expected YYYY-MM-DD.");
    }
  } else {
    date = new Date();
  }

  const ptAttendance = await CoachService.getPtAttendance(coachReq.coachDocId, date);
  return new SuccessResponse("PT attendance fetched", ptAttendance).send(res);
});
