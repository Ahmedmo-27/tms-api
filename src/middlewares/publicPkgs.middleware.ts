import { Request, Response, NextFunction, RequestHandler } from "express";
import { AuthRequest } from "./auth.middleware";
import Member from "../models/member";
import Package from "../models/package";
import asyncHandler from "../utils/asyncHandler";
import { SuccessResponse } from "../core/ApiResponse";
import { buildMatchaPackageFilter } from "../utils/matcha-branch";

export const returnPublicPackages = (): RequestHandler => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthRequest;
      const uid = authReq.user._id as string;

      if (authReq.user.role !== "user") {
        next();
        return;
      }

      const member = await Member.findOne({ uid });

      if (!member) {
        const matchaFilter = await buildMatchaPackageFilter();
        const matchaPkgs = await Package.find(matchaFilter);
        new SuccessResponse("Packages Found!", matchaPkgs).send(res);
        return;
      }

      next();
    },
  );
};
