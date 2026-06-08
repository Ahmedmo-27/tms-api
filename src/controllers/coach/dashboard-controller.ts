import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { CoachService } from "../../services/coach-service";
import { CoachAuthRequest } from "../../middlewares/coach.middleware";
import { DeductSessionRequestDto } from "../../dtos/coach.dto";

/**
 * GET /api/coach/clients
 * Returns the deduplicated list of members linked to the authenticated coach
 * via ScheduledClass documents.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export const getClients = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const clients = await CoachService.getClients(coachReq.coachId);
  return new SuccessResponse("Clients found", { clients }).send(res);
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
  const packages = await CoachService.getMemberPackages(coachReq.coachId, req.params.memberId);
  return new SuccessResponse("Packages found", { packages }).send(res);
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
  const result = await CoachService.deductSession(coachReq.coachId, req.body as DeductSessionRequestDto);
  return new SuccessResponse("Session deducted", { package: result }).send(res);
});
