import asyncHandler from "../../utils/asyncHandler";
import Coach from "../../models/coach";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/ApiError";
import { Types } from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex";

export const addCoach = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { coachName, phoneNumber } = req.body;
    if (!coachName || !phoneNumber) {
      throw new BadRequestError("MISSING_FIELDS", "Coach name and phone number are required");
    }

    const trimmedName = coachName.trim();
    const trimmedPhone = phoneNumber.toString().trim();

    // Check for duplicate coach name (case-insensitive)
    const existingName = await Coach.findOne({
      coachName: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
    });
    if (existingName) {
      throw new ConflictError(
        "COACH_ALREADY_EXISTS",
        `A coach with the name "${trimmedName}" already exists`
      );
    }

    // Check for duplicate phone number (excluding legacy dummy numbers)
    if (trimmedPhone !== "01111111111" && trimmedPhone !== "00000000000") {
      const existingPhone = await Coach.findOne({ phoneNumber: trimmedPhone });
      if (existingPhone) {
        throw new ConflictError(
          "COACH_ALREADY_EXISTS",
          `A coach with the phone number "${trimmedPhone}" already exists (${existingPhone.coachName})`
        );
      }
    }

    const coach = new Coach({ coachName: trimmedName, phoneNumber: trimmedPhone });
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

    if (coachName !== undefined) {
      const trimmedName = coachName.trim();
      const existingName = await Coach.findOne({
        _id: { $ne: new Types.ObjectId(id) },
        coachName: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
      });
      if (existingName) {
        throw new ConflictError(
          "COACH_ALREADY_EXISTS",
          `Another coach with the name "${trimmedName}" already exists`
        );
      }
      updateData.coachName = trimmedName;
    }

    if (phoneNumber !== undefined) {
      const trimmedPhone = phoneNumber.toString().trim();
      if (trimmedPhone !== "01111111111" && trimmedPhone !== "00000000000") {
        const existingPhone = await Coach.findOne({
          _id: { $ne: new Types.ObjectId(id) },
          phoneNumber: trimmedPhone,
        });
        if (existingPhone) {
          throw new ConflictError(
            "COACH_ALREADY_EXISTS",
            `Another coach with the phone number "${trimmedPhone}" already exists (${existingPhone.coachName})`
          );
        }
      }
      updateData.phoneNumber = trimmedPhone;
    }

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
