import asyncHandler from "../../utils/asyncHandler";
import Coach from "../../models/coach";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { Types } from "mongoose";

export const addCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { coachName, phoneNumber } = req.body;
    if (!coachName || !phoneNumber) {
      throw new BadRequestError("MISSING_FIELDS", "Coach name and phone number are required");
    }
    const coach = new Coach({ coachName: coachName.trim(), phoneNumber: phoneNumber.toString().trim() });
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
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("INVALID_ID", "Invalid coach ID format");
    }
    const { coachName, phoneNumber } = req.body;
    const updateData: Record<string, any> = {};
    if (coachName !== undefined) updateData.coachName = coachName.trim();
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber.toString().trim();

    const coach = await Coach.findByIdAndUpdate(id, updateData, { new: true });
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { id });
    new SuccessResponse("Coach Updated!", coach).send(res);
  }
);

export const deleteCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("INVALID_ID", "Invalid coach ID format");
    }
    const coach = await Coach.findByIdAndDelete(id);
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { id });
    new SuccessResponse("Coach Deleted!", coach).send(res);
  }
);

export const getUnlinkedCoaches = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const coaches = await Coach.find({
      $or: [{ userId: { $exists: false } }, { userId: null }],
      coachName: { $not: /&|\band\b|\//i }
    });
    new SuccessResponse("Unlinked Coaches Found!", coaches).send(res);
  }
);
