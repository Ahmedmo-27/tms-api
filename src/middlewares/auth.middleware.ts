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
import logger from "../config/logger";

// This interface is for routes/controllers that run after the middleware
export interface AuthRequest extends Request {
  user: IUser & IUserMethods;
  deviceType: "web" | "mobile";
}

export interface AuthResponse extends Response {
  user: IUser & IUserMethods;
  deviceType: "web" | "mobile";
}

type UserRole =
  | "member"
  | "user"
  | "admin"
  | "management"
  | "branch_admin"
  | "coach"
  | "managing_coach"
  | "mailer";

const ADMIN_ROLE_ALIASES: UserRole[] = ["admin", "management", "branch_admin"];

/**
 * NOTE: Passing "admin" in allowedRoles expands to management + branch_admin + admin.
 * Call sites using ["admin"] automatically allow all three management roles.
 */
function roleIsAllowed(userRole: string, allowedRoles: UserRole[]): boolean {
  const normalizedUserRole = userRole === "admin" ? "management" : userRole;
  const expandedRoles = new Set<UserRole>();
  for (const role of allowedRoles) {
    if (role === "admin") {
      ADMIN_ROLE_ALIASES.forEach((r) => expandedRoles.add(r));
    } else {
      expandedRoles.add(role);
    }
  }
  return expandedRoles.has(normalizedUserRole as UserRole);
}

// Error codes for auth middleware
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
        throw new BadTokenError("INVALID_TOKEN", "Invalid token - invalid format");
      }
    } else {
      token = req.cookies.token;
      deviceType = "web";
    }
    if (!token)
      throw new AuthFailureError("MISSING_TOKEN", "Authentication required - no token provided");

    let decoded: {
      uid: string;
      role: string;
      deviceType?: string;
      jti?: string;
      iat?: number;
      exp?: number;
    };
    let jwtExpired = false;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret)
        throw new InternalError("JWT_ERROR", "JWT_SECRET is not defined in environment variables");

      // For Bearer tokens (mobile client), ignore token expiration so mobile users never expire.
      // Cryptographic signature is still strictly verified against secret.
      decoded = jwt.verify(token, secret, {
        ignoreExpiration: deviceType === "mobile",
      }) as any;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        // If deviceType was web (cookie) but the token expired, try decoding without expiration
        // to check if it's a member/user before rejecting.
        try {
          const secret = process.env.JWT_SECRET!;
          decoded = jwt.verify(token, secret, { ignoreExpiration: true }) as any;
          jwtExpired = true;
        } catch {
          throw new TokenExpiredError("TOKEN_EXPIRED", "Token expired");
        }
      } else {
        throw new BadTokenError("INVALID_TOKEN", "Invalid token!");
      }
    }

    const user = await User.findOne({
      _id: new Types.ObjectId(decoded.uid),
      "tokens.token": token,
    });
    if (!user) throw new BadTokenError("INVALID_TOKEN", "Invalid token - user not found or token revoked");

    const isMemberOrMobile =
      deviceType === "mobile" ||
      user.role === "member" ||
      user.role === "user";

    // For web staff users, enforce token expiration
    if (!isMemberOrMobile && deviceType === "web") {
      const matchedToken = user.tokens.find((t) => t.token === token);
      if (jwtExpired || (matchedToken?.expiresIn && new Date(matchedToken.expiresIn) <= new Date())) {
        throw new TokenExpiredError("TOKEN_EXPIRED", "Token expired");
      }
    }

    // Self-healing: if an active member token has an old expiresIn or web device label in DB,
    // convert it to a non-expiring mobile token so it is permanently protected.
    if (isMemberOrMobile) {
      const matchedToken = user.tokens.find((t) => t.token === token);
      if (matchedToken && (matchedToken.expiresIn || matchedToken.device !== "mobile")) {
        matchedToken.expiresIn = undefined;
        matchedToken.device = "mobile";
        user.save().catch((err) =>
          logger.warn("Failed to persist self-healing member token", { error: (err as Error).message })
        );
      }
    }

    (req as AuthRequest).user = user;
    (req as AuthRequest).deviceType = isMemberOrMobile ? "mobile" : deviceType;
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
      if (!roleIsAllowed(authReq.user.role, allowedRoles))
        throw new ForbiddenError("INSUFFICIENT_PERMISSIONS", "Access denied - Insufficient permissions");
      next();
    }
  );
};

