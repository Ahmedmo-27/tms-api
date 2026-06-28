import { Request, Response, NextFunction, RequestHandler } from "express";
import { AuthRequest } from "./auth.middleware";
import Member from "../models/member";
import Package from "../models/package";
import asyncHandler from "../utils/asyncHandler";
import { NotFoundError } from "../core/ApiError";
import { SuccessResponse } from "../core/ApiResponse";

const RAMADAN_PACKAGE_NAMES = [
  "WHOLE-E Ramadan",
  "Pilates Ramadan Program 12 Classes",
  "Functional Ramadan Program 12 Sessions",
  "Functional Unlimited Ramadan",
  "Ultimate Ramadan Mix",
];

export const returnPublicPackages = (): RequestHandler => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthRequest;
      const role = authReq.user.role;

      // ✅ If user is not a member → return packages directly
      if (role === "user") {
        const ramadanPkgs = await Package.find({
          name: { $in: RAMADAN_PACKAGE_NAMES },
        });

        if (!ramadanPkgs.length) {
          throw new NotFoundError(
            "PACKAGE_NOT_FOUND",
            "Ramadan packages are not registered",
          );
        }
        new SuccessResponse("Packages Found!", ramadanPkgs).send(res);
        return; // Stop further execution
      }

      // ✅ If member exists → continue to next middleware/controller
      next();
    },
  );
};
