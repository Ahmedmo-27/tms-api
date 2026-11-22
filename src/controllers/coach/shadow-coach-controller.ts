import { Request, Response } from "express";
import { Types } from "mongoose";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../core/ApiError";
import ScheduledClass from "../../models/scheduledClass";
import Coach from "../../models/coach";
import User from "../../models/user";
import { CoachAuthRequest } from "../../middlewares/coach.middleware";
import { ShadowCoachService } from "../../services/shadow-coach-service";

/**
 * GET /api/coach/classes/:scid/shadow-checklist
 * Returns the shadow coach progress and checklists for the class.
 * Accessible by the assigned lead coach(es) or managing coach.
 */
export const getClassShadowChecklist = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const { scid } = req.params;

  if (!scid || !Types.ObjectId.isValid(scid)) {
    throw new BadRequestError("INVALID_ID", "Invalid class ID format");
  }

  const cls = await ScheduledClass.findById(scid);
  if (!cls) {
    throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
  }

  if (!cls.shadowCoachId) {
    throw new NotFoundError(
      "NO_SHADOW_COACH",
      "This class does not have an assigned shadow coach",
      { scid }
    );
  }

  // Verify access: Lead coach on this class OR managing coach
  const isAssignedLeadCoach = Array.isArray(cls.coachId) && cls.coachId.some(
    (id) => id.toString() === coachReq.coachDocId.toString()
  );
  const isManaging = coachReq.userRole === "managing_coach";

  if (!isAssignedLeadCoach && !isManaging) {
    throw new ForbiddenError(
      "INSUFFICIENT_PERMISSIONS",
      "Only the lead coach of this class or a managing coach can view the shadow coach checklist"
    );
  }

  const progress = await ShadowCoachService.getProgress(cls.shadowCoachId);
  return new SuccessResponse("Shadow coach checklist found", {
    scheduledClassId: scid,
    shadowCoach: {
      id: progress.coachId,
      name: progress.coachName,
      currentPhase: progress.currentPhase,
      phaseLabel: progress.phaseLabel,
      status: progress.status,
    },
    progress,
  }).send(res);
});

/**
 * PATCH /api/coach/classes/:scid/shadow-checklist
 * Marks or unmarks a checklist item on the shadow coach's curriculum.
 * Accessible by the assigned lead coach(es) or managing coach.
 */
export const updateClassShadowChecklist = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const { scid } = req.params;
  const { itemKey, isDone, notes } = req.body;

  if (!scid || !Types.ObjectId.isValid(scid)) {
    throw new BadRequestError("INVALID_ID", "Invalid class ID format");
  }
  if (!itemKey) {
    throw new BadRequestError("MISSING_ITEM_KEY", "itemKey is required");
  }
  if (typeof isDone !== "boolean") {
    throw new BadRequestError("INVALID_IS_DONE", "isDone must be a boolean");
  }

  const cls = await ScheduledClass.findById(scid);
  if (!cls) {
    throw new NotFoundError("CLASS_NOT_FOUND", "Class not found", { scid });
  }

  if (!cls.shadowCoachId) {
    throw new NotFoundError(
      "NO_SHADOW_COACH",
      "This class does not have an assigned shadow coach",
      { scid }
    );
  }

  // Verify access
  const isAssignedLeadCoach = Array.isArray(cls.coachId) && cls.coachId.some(
    (id) => id.toString() === coachReq.coachDocId.toString()
  );
  const isManaging = coachReq.userRole === "managing_coach";

  if (!isAssignedLeadCoach && !isManaging) {
    throw new ForbiddenError(
      "INSUFFICIENT_PERMISSIONS",
      "Only the lead coach of this class or a managing coach can update the shadow coach checklist"
    );
  }

  const viewerCoach = await Coach.findById(coachReq.coachDocId);
  const updatedProgress = await ShadowCoachService.markChecklistItem(
    cls.shadowCoachId,
    itemKey,
    isDone,
    {
      _id: coachReq.coachDocId,
      coachName: viewerCoach?.coachName,
    },
    scid,
    notes
  );

  return new SuccessResponse("Checklist item updated", updatedProgress).send(res);
});

/**
 * GET /api/coach/managing/shadow-coaches
 * Lists all shadow coaches, their phases, and training progress.
 * Restricted to managing coaches.
 */
export const getManagingShadowCoaches = asyncHandler(async (_req: Request, res: Response) => {
  const shadowCoaches = await ShadowCoachService.listShadowCoaches();
  return new SuccessResponse("Shadow coaches retrieved", shadowCoaches).send(res);
});

/**
 * GET /api/coach/managing/shadow-coaches/:coachId
 * Detailed curriculum progress for a specific shadow coach.
 * Restricted to managing coaches.
 */
export const getManagingShadowCoachDetail = asyncHandler(async (req: Request, res: Response) => {
  const { coachId } = req.params;
  if (!coachId || !Types.ObjectId.isValid(coachId)) {
    throw new BadRequestError("INVALID_ID", "Invalid coach ID format");
  }
  const progress = await ShadowCoachService.getProgress(coachId);
  return new SuccessResponse("Shadow coach progress retrieved", progress).send(res);
});

/**
 * PATCH /api/coach/managing/shadow-coaches/:coachId/phase
 * Updates the current phase for a shadow coach (1, 2, or 3).
 * Restricted to managing coaches.
 */
export const updateManagingShadowCoachPhase = asyncHandler(async (req: Request, res: Response) => {
  const { coachId } = req.params;
  const { phase } = req.body;

  if (!coachId || !Types.ObjectId.isValid(coachId)) {
    throw new BadRequestError("INVALID_ID", "Invalid coach ID format");
  }
  const numericPhase = Number(phase);
  if (isNaN(numericPhase) || numericPhase < 1 || numericPhase > 3) {
    throw new BadRequestError("INVALID_PHASE", "Phase must be 1, 2, or 3");
  }

  const updated = await ShadowCoachService.setPhase(coachId, numericPhase);
  return new SuccessResponse("Shadow coach phase updated", updated).send(res);
});

/**
 * POST /api/coach/managing/shadow-coaches/:coachId/decision
 * Submits the managing coach decision: promote to coach or retain as shadow coach.
 * Restricted to managing coaches.
 */
export const evaluateManagingShadowCoach = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const { coachId } = req.params;
  const { decision, notes } = req.body;

  if (!coachId || !Types.ObjectId.isValid(coachId)) {
    throw new BadRequestError("INVALID_ID", "Invalid coach ID format");
  }
  if (decision !== "promote" && decision !== "retain") {
    throw new BadRequestError("INVALID_DECISION", "Decision must be 'promote' or 'retain'");
  }

  const managingUser = await User.findById(coachReq.coachId);
  if (!managingUser || managingUser.role !== "managing_coach") {
    throw new ForbiddenError(
      "INSUFFICIENT_PERMISSIONS",
      "Only managing coaches can evaluate shadow coaches"
    );
  }

  const result = await ShadowCoachService.evaluateCandidate(
    coachId,
    managingUser,
    decision,
    notes
  );

  const message =
    decision === "promote"
      ? "Shadow coach successfully promoted to Coach"
      : "Shadow coach retained in training program";

  return new SuccessResponse(message, result).send(res);
});
