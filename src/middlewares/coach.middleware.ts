import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import User from "../models/user";
import Coach from "../models/coach";
import asyncHandler from "../utils/asyncHandler";
import {
  AuthFailureError,
  BadTokenError,
  ForbiddenError,
  InternalError,
  TokenExpiredError,
} from "../core/ApiError";

// This interface is for routes/controllers that run after the middleware
export interface CoachAuthRequest extends Request {
  coachId: Types.ObjectId;
  coachDocId: Types.ObjectId;
}

export const coachGuard = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let token: string | undefined;
    let deviceType: "web" | "mobile" = "mobile";

    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
        deviceType = "mobile";
      } else {
        throw new AuthFailureError("MISSING_TOKEN", "Invalid token - invalid format");
      }
    } else {
      // Allow cookie-based web tokens for coach routes as well
      token = (req as any).cookies?.token;
      deviceType = "web";
    }

    if (!token) {
      throw new AuthFailureError("MISSING_TOKEN", "Authentication required - no token provided");
    }

    let decoded: { uid: string; role: string; deviceType: string; jti: string; iat: number };
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new InternalError("JWT_ERROR", "JWT_SECRET is not defined in environment variables");
      }
      decoded = jwt.verify(token, secret) as {
        uid: string;
        role: string;
        deviceType: string;
        jti: string;
        iat: number;
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError("TOKEN_EXPIRED", "Token expired");
      }
      throw new BadTokenError("INVALID_TOKEN", "Invalid token!");
    }

    if (decoded.role !== "coach") {
      throw new ForbiddenError("INSUFFICIENT_PERMISSIONS", "Access denied - coach role required");
    }

    const user = await User.findOne({
      _id: new Types.ObjectId(decoded.uid),
      "tokens.token": token,
    });

    if (!user) {
      throw new BadTokenError("INVALID_TOKEN", "Invalid token - user not found or token revoked");
    }

    (req as CoachAuthRequest).coachId = new Types.ObjectId(decoded.uid);

    const coachDoc = await Coach.findOne({ userId: (req as CoachAuthRequest).coachId });
    if (!coachDoc) {
      throw new ForbiddenError("COACH_PROFILE_NOT_FOUND", "Coach profile not found for this user");
    }
    (req as CoachAuthRequest).coachDocId = coachDoc._id as Types.ObjectId;

    // Optionally expose device type if downstream logic needs it
    (req as any).deviceType = deviceType;
    next();
  }
);
