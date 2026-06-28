import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import User, { IUser, IUserMethods } from "../models/user";
import asyncHandler from "../utils/asyncHandler";
import {
  AuthFailureError,
  BadTokenError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TokenExpiredError,
} from "../core/ApiError";
import {Types} from "mongoose";
import { SuccessResponse } from "../core/ApiResponse";

// This interface is for routes/controllers that run after the middleware
export interface AuthRequest extends Request {
  user: IUser & IUserMethods;
  deviceType: "web" | "mobile";
}

export interface AuthResponse extends Response {
  user: IUser & IUserMethods;
  deviceType: "web" | "mobile";
}

type UserRole = "member" | "user" | "admin" | "management" | "branch_admin" | "fd" | "coach";

// CHANGE ERROR CODES AFTER UPDATE
export const authenticateUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token: string;
    let deviceType: "web" | "mobile";
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
        deviceType = "mobile";
      } else {
        throw new BadTokenError("MEMBER_NOT_FOUND", "Invalid token - invalid format");
      }
    } else {
      token = req.cookies.token;
      deviceType = "web";
    }
    if (!token)
      throw new AuthFailureError("MISSING_TOKEN", "Authentication required - no token provided");

    let decoded;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret)
        throw new InternalError("JWT_ERROR", "JWT_SECRET is not defined in environment variables");
      decoded = jwt.verify(token, secret) as {
        uid: string;
        role: string;
        deviceType: string;
        jti: string;
        iat: number;
       };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError("MEMBER_NOT_FOUND", "Token expired");
      }
      throw new BadTokenError("MEMBER_NOT_FOUND", "Invalid token!");
    }
    const user = await User.findOne({
      _id: new Types.ObjectId(decoded.uid),
      "tokens.token": token,
    });
    if (!user) throw new BadTokenError("MEMBER_NOT_FOUND", "Invalid token - user not found or token revoked");
    (req as AuthRequest).user = user;
    (req as AuthRequest).deviceType = deviceType;
    next();
  }
);
export const authorizeUser = (allowedRoles: UserRole[]): RequestHandler => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthRequest;
      if (!authReq.user.role) {
        throw new AuthFailureError("AUTH_FAILURE", "Authentication required");
      }
      if (!allowedRoles.includes(authReq.user.role as UserRole))
        throw new ForbiddenError("INSUFFICIENT_PERMISSIONS", "Access denied - Insufficient permissions");
      next();
    }
  );
};

