import asyncHandler from "../../utils/asyncHandler";
import Coach from "../../models/coach";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { NotFoundError } from "../../core/ApiError";

export const addCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { coachName, phoneNumber } = req.body;
    const coach = new Coach({ coachName, phoneNumber });
    await coach.save();
    new SuccessResponse("Coach Added!", coach).send(res);
  }
);

export const getCoaches = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const coaches = await Coach.find();
    new SuccessResponse("Coaches Found!", coaches).send(res);
  }
);

export const updateCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { coachName, phoneNumber } = req.body;
    const coach = await Coach.findByIdAndUpdate(id, { coachName, phoneNumber }, { new: true });
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { id });
    new SuccessResponse("Coach Updated!", coach).send(res);
  }
);

export const deleteCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const coach = await Coach.findByIdAndDelete(id);
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { id });
    new SuccessResponse("Coach Deleted!", coach).send(res);
  }
);
