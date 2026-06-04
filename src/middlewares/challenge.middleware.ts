import { Request, Response, NextFunction, RequestHandler } from "express";
import { AuthRequest } from "./auth.middleware";
import Member from "../models/member";
import Package from "../models/package";
import asyncHandler from "../utils/asyncHandler";
import { ForbiddenError, NotFoundError } from "../core/ApiError";
import logger from "../config/logger";

export const checkChallengeSubscription = (): RequestHandler => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthRequest;
      const uid = authReq.user._id as string;
      const user = authReq.user;

      logger.info("Checking challenge subscription for user:", uid);

      // ✅ If user already flagged as Ramadan package holder
      if (user.hasRamadanPackage) {
        logger.info("User has Ramadan package, allowing access.");
        return next();
      }

      logger.info("Checking member record...");

      const member = await Member.findOne({ uid });
      if (!member) {
        throw new NotFoundError("MEMBER_NOT_FOUND", "User is not a member");
      }

      // ============================================================
      // 🔒 OLD RAMADAN-SPECIFIC LOGIC (COMMENTED FOR NOW)
      // ============================================================

      /*
      const ramadanPackages = await Package.find({
        name: {
          $in: [
            "WHOLE-E Ramadan",
            "Pilates Ramadan Program 12 Classes",
            "Functional Ramadan Program 12 Sessions",
            "Functional Unlimited Ramadan",
            "Ultimate Ramadan Mix",
          ],
        },
      });

      if (!ramadanPackages || ramadanPackages.length === 0) {
        throw new NotFoundError(
          "PACKAGE_NOT_FOUND",
          "Ramadan packages are not registered",
        );
      }

      const hasActiveRamadanPackage = member.packages.some(
        (memberPkg) =>
          memberPkg.status === "ACTIVE" &&
          ramadanPackages.some(
            (ramadanPkg) =>
              ramadanPkg._id.toString() === memberPkg.pkgId.toString(),
          ),
      );

      if (!hasActiveRamadanPackage) {
        throw new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          "No active Ramadan package found",
        );
      }
      */

      // ============================================================
      // ✅ NEW LOGIC: CHECK FOR ANY ACTIVE PACKAGE
      // ============================================================

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