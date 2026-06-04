import { Request, Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import Member from "../../models/member";
import Package from "../../models/package";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import logger from "../../config/logger";
import { SubscriptionsService } from "../../services/subscriptions-service";

// GET all packages to subscribe
export const getPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { name, category, coachId } = req.query;
  const query: any = {};
  if (name) {
    query.name = { $regex: name, $options: "i" };
  }
  if (category) {
    query.category = category;
  }
  if (coachId) {
    query.coachId = coachId;
  }
  query.hidden = {$ne: true}

  let packages = await Package.find(query);
  if (!packages || packages.length === 0)
    throw new NotFoundError("PACKAGES_NOT_FOUND", "Packages not found");
  new SuccessResponse("Packages Found!", packages).send(res);
});



export const getMemberPackages = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id;
  const member = await Member.findOne({ uid: _id });
  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { _id });
  logger.info(member.packages);
  new SuccessResponse("Packages Found!", member.packages).send(res);
});

export const subToPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id as string;
  const { pkgId, merchantReferenceId, promoCode } = req.body;
  await SubscriptionsService.subscribeToPackage(
    _id,
    pkgId,
    new Date().toISOString(),
    "APP",
    merchantReferenceId,
    promoCode,
  );
  new SuccessResponse("Package Added!").send(res);
});

export const unsubFromPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id as string;
  const pkgId = req.params.pkgId;
  const pkgStartDate = req.query.pkgStartDate as string
  await SubscriptionsService.unsubscribeFromPackage(_id, pkgId, pkgStartDate);
  new SuccessResponse("Package Deleted!").send(res);
});
