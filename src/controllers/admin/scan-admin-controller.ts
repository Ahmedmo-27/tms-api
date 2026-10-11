import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, ForbiddenError } from "../../core/ApiError";
import { resolveLocationFilter } from "../../utils/location-scope";
import { SchedulerService } from "../../services/scheduler-service";
import DailyAttendance from "../../models/dailyAttendance";
import {
  ScanAdminService,
  ScanRowChanges,
  ScanRowRef,
  isScanSource,
} from "../../services/scan-admin-service";

/**
 * Branch admins may only touch rows recorded at their own branch. Class rows
 * are scoped by the session's location, daily rows by the row's own locationId.
 */
async function assertRowAccess(req: Request, ref: ScanRowRef): Promise<void> {
  const restrictTo = resolveLocationFilter(req);
  if (!restrictTo) return;

  if (ref.source === "class") {
    await SchedulerService.assertSessionAtLocation(ref.parentId, restrictTo);
    return;
  }

  const day = await DailyAttendance.findById(ref.parentId);
  if (!day) return;
  const arrayPath = ref.source === "pt" ? "ptAttendance" : "openGymAttendance";
  const row = (day[arrayPath] as any).id(ref.rowId);
  if (row && row.locationId && row.locationId.toString() !== restrictTo) {
    throw new ForbiddenError(
      "WRONG_BRANCH",
      "This check-in belongs to another branch",
    );
  }
}

function readRef(req: Request): ScanRowRef {
  const { source, parentId, rowId } = req.params;
  if (!isScanSource(source)) {
    throw new BadRequestError(
      "INVALID_SOURCE",
      "Source must be one of: class, pt, open-gym",
    );
  }
  return { source, parentId, rowId };
}

export const updateScanRow = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const ref = readRef(req);
  await assertRowAccess(req, ref);

  const { uid, pkgId, time, status, guestName, guestPhone } = req.body ?? {};
  if (status !== undefined && status !== "SUCCESS" && status !== "FAILED") {
    throw new BadRequestError("INVALID_STATUS", "Status must be SUCCESS or FAILED");
  }

  const changes: ScanRowChanges = {};
  if (uid !== undefined) changes.uid = uid;
  if (pkgId !== undefined) changes.pkgId = pkgId;
  if (time !== undefined) changes.time = time;
  if (status !== undefined) changes.status = status;
  if (guestName !== undefined) changes.guestName = guestName;
  if (guestPhone !== undefined) changes.guestPhone = guestPhone;

  if (Object.keys(changes).length === 0) {
    throw new BadRequestError("NO_CHANGES", "No fields to update");
  }

  const row = await ScanAdminService.updateScanRow(ref, changes);
  new SuccessResponse("Scan updated", row).send(res);
});

export const deleteScanRow = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const ref = readRef(req);
  await assertRowAccess(req, ref);

  // Defaults to returning the session; pass restoreSession=false to only drop the row.
  const raw = req.query.restoreSession ?? req.body?.restoreSession;
  const restoreSession = raw === undefined ? true : raw !== "false" && raw !== false;

  await ScanAdminService.deleteScanRow(ref, { restoreSession });
  new SuccessResponse("Scan deleted", { restoreSession }).send(res);
});

export const getScanRow = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const ref = readRef(req);
  await assertRowAccess(req, ref);
  const row = await ScanAdminService.getScanRow(ref);
  new SuccessResponse("Scan fetched", row).send(res);
});
