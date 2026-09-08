import { Request, Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { FreezeService } from "../../services/freeze-service";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { resolveLocationFilter } from "../../utils/location-scope";

export const getFreezeRequests = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { status, search, page, limit } = req.query;
  const locationId = resolveLocationFilter(req);

  const result = await FreezeService.getFreezeRequests({
    status: status as string,
    locationId,
    search: search as string,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
  });

  new SuccessResponse("Freeze Requests Found!", result).send(res);
});

export const getFrozenPackages = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { search, page, limit } = req.query;
  const locationId = resolveLocationFilter(req);

  const result = await FreezeService.getFrozenPackages({
    locationId,
    search: search as string,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 20,
  });

  new SuccessResponse("Frozen Packages Found!", result).send(res);
});

export const approveFreezeRequest = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const adminId = (authReq.user as any)._id.toString();
  const { id } = req.params;
  const { approvedDurationDays, adminNote } = req.body;

  const request = await FreezeService.approveFreezeRequest(
    id,
    adminId,
    approvedDurationDays !== undefined ? Number(approvedDurationDays) : undefined,
    adminNote
  );

  new SuccessResponse("Freeze Request Approved Successfully!", request).send(res);
});

export const rejectFreezeRequest = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const adminId = (authReq.user as any)._id.toString();
  const { id } = req.params;
  const { rejectionReason } = req.body;

  const request = await FreezeService.rejectFreezeRequest(
    id,
    adminId,
    rejectionReason
  );

  new SuccessResponse("Freeze Request Rejected Successfully!", request).send(res);
});

export const adminFreezePackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const adminId = (authReq.user as any)._id.toString();
  const { uid, pkgId, pkgStartDate, durationDays, reason } = req.body;

  const pkg = await FreezeService.freezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
    durationDays: Number(durationDays),
    type: "ADMIN",
    reason,
    adminId,
  });

  new SuccessResponse("Package Frozen by Admin Successfully!", pkg).send(res);
});

export const adminUnfreezePackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const adminId = (authReq.user as any)._id.toString();
  const { uid, pkgId, pkgStartDate } = req.body;

  const pkg = await FreezeService.unfreezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
    adminId,
  });

  new SuccessResponse("Package Unfrozen by Admin Successfully!", pkg).send(res);
});
