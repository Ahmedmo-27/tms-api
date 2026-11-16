import { Request, Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { FreezeService } from "../../services/freeze-service";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { invalidateMemberPackageCache } from "../../cache/response-cache";

export const freezeMyPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = (authReq.user as any)._id.toString();
  const { pkgId, pkgStartDate, durationDays, reason } = req.body;

  const pkg = await FreezeService.freezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
    durationDays: Number(durationDays),
    type: "STANDARD",
    reason,
  });

  invalidateMemberPackageCache(uid);
  new SuccessResponse("Package Frozen Successfully!", pkg).send(res);
});

export const unfreezeMyPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = (authReq.user as any)._id.toString();
  const { pkgId, pkgStartDate } = req.body;

  const pkg = await FreezeService.unfreezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
  });

  invalidateMemberPackageCache(uid);
  new SuccessResponse("Package Unfrozen Successfully!", pkg).send(res);
});

export const requestExtraFreeze = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = (authReq.user as any)._id.toString();
  const { pkgId, pkgStartDate, requestedDurationDays, reason } = req.body;

  const request = await FreezeService.requestExtraFreeze(
    uid,
    pkgId,
    pkgStartDate,
    Number(requestedDurationDays),
    reason
  );

  invalidateMemberPackageCache(uid);
  new SuccessResponse("Extra Freeze Request Submitted Successfully!", request).send(res);
});

export const getMyFreezeRequests = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = (authReq.user as any)._id.toString();

  const requests = await FreezeService.getMemberFreezeRequests(uid);
  new SuccessResponse("Freeze Requests Found!", requests).send(res);
});
