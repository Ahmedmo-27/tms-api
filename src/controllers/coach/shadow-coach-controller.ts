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
import { SchedulerService } from "../../services/scheduler-service";

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
  if (!managingUser || !["managing_coach", "management", "branch_admin"].includes(managingUser.role)) {
    throw new ForbiddenError(
      "INSUFFICIENT_PERMISSIONS",
      "Only managing coaches and management staff can evaluate shadow coaches"
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

/**
 * GET /api/coach/shadow/my-checklist
 * Allows the logged-in coach (specifically shadow coaches) to track their own 3-month curriculum,
 * current month target checklist, completed competencies with verifying lead coach signatures,
 * and remaining competencies for the current month.
 */
export const getMyShadowChecklist = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  let coachDocId = coachReq.coachDocId;

  if (!coachDocId && coachReq.coachId) {
    const coachDoc = await Coach.findOne({ userId: coachReq.coachId });
    if (coachDoc) {
      coachDocId = coachDoc._id as Types.ObjectId;
    }
  }

  if (!coachDocId) {
    throw new NotFoundError("COACH_NOT_FOUND", "Coach profile not found");
  }

  const progress = await ShadowCoachService.getProgress(coachDocId);

  const currentPhaseNum = progress.currentPhase || 1;
  const currentPhaseData = progress.phases.find((p) => p.phaseNumber === currentPhaseNum) || progress.phases[0];

  const checkedItems = (currentPhaseData?.checklist || []).filter((i: any) => i.isDone);
  const remainingItems = (currentPhaseData?.checklist || []).filter((i: any) => !i.isDone);

  const currentMonthTotal = currentPhaseData?.checklist?.length || 0;
  const currentMonthDone = checkedItems.length;
  const currentMonthPercent = currentMonthTotal > 0 ? Math.round((currentMonthDone / currentMonthTotal) * 100) : 0;

  return new SuccessResponse("My shadow checklist retrieved", {
    ...progress,
    currentMonth: {
      phaseNumber: currentPhaseNum,
      title: currentPhaseData?.title || "",
      guidelines: currentPhaseData?.guidelines || "",
      isPhaseComplete: currentPhaseData?.isPhaseComplete || false,
      totalCount: currentMonthTotal,
      completedCount: currentMonthDone,
      progressPercent: currentMonthPercent,
      checkedItems,
      remainingItems,
    },
  }).send(res);
});

/**
 * PATCH /api/coach/managing/classes/:scid/shadow-coach
 * Allows managing coaches to assign, update, or remove a shadow coach for an existing scheduled class.
 * Body: { shadowCoachId?: string | null }
 */
export const assignClassShadowCoach = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const { scid } = req.params;
  const { shadowCoachId } = req.body;

  if (!scid || !Types.ObjectId.isValid(scid)) {
    throw new BadRequestError("INVALID_ID", "Invalid scheduled class ID format");
  }

  const updated = await SchedulerService.editClass(
    { shadowCoachId: shadowCoachId === "none" || !shadowCoachId ? null : shadowCoachId },
    scid,
    null,
    coachReq.userRole
  );

  return new SuccessResponse("Shadow coach assigned to class successfully", updated).send(res);
});

/**
 * GET /api/coach/managing/classes/upcoming
 * Returns upcoming scheduled classes with lead coaches, location, and currently assigned shadow coach.
 * Allows managing coaches to quickly browse classes and assign shadow coaches.
 */
export const getUpcomingClassesForAssignment = asyncHandler(async (req: Request, res: Response) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const classes = await ScheduledClass.find({
    startTime: { $gte: startOfDay },
  })
    .sort({ startTime: 1 })
    .limit(100)
    .populate("cid", "name title description")
    .populate("locationId", "name address")
    .populate("coachId", "coachName email phone profilePicture")
    .populate("shadowCoachId", "coachName email phone profilePicture");

  return new SuccessResponse("Upcoming classes retrieved", classes).send(res);
});

