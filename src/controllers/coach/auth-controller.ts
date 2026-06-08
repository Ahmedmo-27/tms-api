import { Request, Response, CookieOptions } from "express";
import { Types } from "mongoose";
import User from "../../models/user";
import { BadRequestError, ForbiddenError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import Package from "../../models/package";
import Coach from "../../models/coach";
import ScheduledClass from "../../models/scheduledClass";

export const coachLogin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumber, password } = req.body;
    const deviceType = req.headers["x-device-type"] ? "mobile" : "web";

    // Validate required fields before any DB call (Requirement 3.1)
    if (!phoneNumber || !password) {
      throw new BadRequestError("MISSING_FIELDS", "Phone number and password are required");
    }

    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");

    // Authenticate user — propagates NotFoundError on invalid credentials (Requirement 3.4)
    const user = await User.findByCredentials(cleanPhoneNumber, password);

    // Verify the user has the coach role (Requirement 3.3)
    if (user.role !== "coach") {
      throw new ForbiddenError("INSUFFICIENT_PERMISSIONS", "Access restricted to coach accounts");
    }

    // Generate token only after role check passes (Requirement 3.2, 3.5)
    const token = await user.generateAuthToken(deviceType);

    if (deviceType === "web") {
      const isProd = process.env.NODE_ENV === "production";
      const cookieOptions: CookieOptions = {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? ("none" as "none" | "lax" | "strict") : ("lax" as "none" | "lax" | "strict"),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      };
      res.cookie("token", token, cookieOptions);
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
      hasPtSessions,
      hasScheduledClasses,
    }).send(res);
  }
);
