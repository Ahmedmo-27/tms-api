import { Request, Response } from "express";
import { Types } from "mongoose";
import User from "../../models/user";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import Package from "../../models/package";
import Coach from "../../models/coach";
import ScheduledClass from "../../models/scheduledClass";
import { authCookieOptions } from "../../utils/authCookies";
import { CoachService } from "../../services/coach-service";
import { CoachAuthRequest } from "../../middlewares/coach.middleware";

export const coachLogin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumber, password } = req.body;
    const deviceType = (req.headers["x-device-type"] || req.headers["xdevice-type"]) ? "mobile" : "web";

    if (!phoneNumber || !password) {
      throw new BadRequestError("MISSING_FIELDS", "Phone number and password are required");
    }

    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");

    const user = await User.findByCredentials(cleanPhoneNumber, password);

    if (user.role !== "coach") {
      throw new ForbiddenError("INSUFFICIENT_PERMISSIONS", "Access restricted to coach accounts");
    }

    const token = await user.generateAuthToken(deviceType);

    if (deviceType === "web") {
      res.cookie("token", token, authCookieOptions());
    }

    let hasPtSessions = false;
    let hasScheduledClasses = false;
    const coachDoc = await Coach.findOne({ userId: user._id });
    if (coachDoc) {
      const ptPackagesCount = await Package.countDocuments({ coachId: coachDoc._id as Types.ObjectId });
      hasPtSessions = ptPackagesCount > 0;

      const scheduledClassesCount = await ScheduledClass.countDocuments({ coachId: coachDoc._id as Types.ObjectId });
      hasScheduledClasses = scheduledClassesCount > 0;
    }

    new SuccessResponse("Login successful", {
      token,
      coachId: coachDoc ? (coachDoc._id as Types.ObjectId).toString() : (user._id as Types.ObjectId).toString(),
      name: user.name,
      hasPtSessions,
      hasScheduledClasses,
    }).send(res);
  }
);

export const getCoachMe = asyncHandler(async (req: Request, res: Response) => {
  const coachReq = req as CoachAuthRequest;
  const profile = await CoachService.getMe(coachReq.coachId, coachReq.coachDocId);
  return new SuccessResponse("Coach profile", profile).send(res);
});

export const changeCoachPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const coachReq = req as CoachAuthRequest;
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      throw new BadRequestError(
        "MISSING_FIELDS",
        "Current password and new password are required",
      );
    }

    if (typeof newPassword !== "string" || newPassword.length < 10) {
      throw new BadRequestError(
        "WEAK_PASSWORD",
        "Password must be at least 10 characters",
      );
    }

    const user = await User.findById(coachReq.coachId);
    if (!user) {
      throw new NotFoundError("USER_NOT_FOUND", "User not found");
    }

    const matches = await user.comparePassword(String(currentPassword));
    if (!matches) {
      throw new BadRequestError(
        "INVALID_CREDENTIALS",
        "Current password is incorrect",
      );
    }

    user.password = String(newPassword);
    await user.save();

    new SuccessResponse("Password updated", {}).send(res);
  },
);
