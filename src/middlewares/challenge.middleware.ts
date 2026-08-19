import { Request, Response, NextFunction, RequestHandler } from "express";
import { AuthRequest } from "./auth.middleware";
import Member from "../models/member";
import asyncHandler from "../utils/asyncHandler";
import { ForbiddenError, NotFoundError } from "../core/ApiError";
import logger from "../config/logger";

export const checkChallengeSubscription = (): RequestHandler => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthRequest;
      const uid = authReq.user._id as string;

      logger.info("Checking challenge subscription for user:", uid);

      const member = await Member.findOne({ uid });
      if (!member) {
        throw new NotFoundError("MEMBER_NOT_FOUND", "User is not a member");
      }

      // Always derive access from active packages (do not trust sticky hasRamadanPackage alone)
      const hasActivePackage = member.packages.some(
        (memberPkg) => memberPkg.status === "ACTIVE",
      );

      if (!hasActivePackage) {
        throw new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          "No active package found",
        );
      }

      logger.info("Active package found. Access granted.");
      next();
    },
  );
};
