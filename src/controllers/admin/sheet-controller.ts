import { Request, Response } from "express";
import { Types } from "mongoose";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";
import Location from "../../models/location";
import {
  resolveLocationFilter,
  resolveLocationIdForWrite,
} from "../../utils/location-scope";
import { cairoDateKey } from "../../utils/timezone";
import { SheetService, type SheetCommitRow } from "../../services/sheet-service";

export const getSheetDay = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const date = (req.query.date as string) || cairoDateKey(new Date());
  let locationId = resolveLocationFilter(req);
  if (!locationId && req.query.locationId !== "all") {
    const cairoBranch =
      (await Location.findOne({ branchName: { $regex: /^cairo$/i } })) ||
      (await Location.findOne({ branchName: { $regex: /cairo/i } })) ||
      (await Location.findOne({ location: { $regex: /cairo/i } }));
    if (cairoBranch) {
      locationId = (cairoBranch._id as Types.ObjectId).toString();
    }
  }
  const data = await SheetService.getDay(date, locationId);
  new SuccessResponse("Sheet day loaded", data).send(res);
});

export const getSheetMemberEligibility = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const memberId = req.query.memberId as string | undefined;
  const pane = req.query.pane === "space_pt" ? "space_pt" : "class";
  const scid = req.query.scid as string | undefined;
  if (!memberId) {
    throw new BadRequestError("INVALID_REQUEST", "memberId is required");
  }
  const data = await SheetService.getMemberEligibility({
    memberId,
    pane,
    scid,
  });
  new SuccessResponse("Member eligibility loaded", data).send(res);
});

export const commitSheetRows = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const locationId = resolveLocationIdForWrite(req);
  const date = (req.body?.date as string) || cairoDateKey(new Date());
  const rows = req.body?.rows as SheetCommitRow[] | undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BadRequestError("INVALID_REQUEST", "rows are required");
  }
  const io = req.app.get("io");
  const results = await SheetService.commitRows({
    date,
    locationId,
    rows,
    io,
  });
  new SuccessResponse("Sheet rows processed", results).send(res);
});

export const importSheetDay = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const locationId = resolveLocationIdForWrite(req);
  const date = (req.body?.date as string) || cairoDateKey(new Date());
  const classes = req.body?.classes;
  const spacePt = req.body?.spacePt;
  if (!Array.isArray(classes) || !Array.isArray(spacePt)) {
    throw new BadRequestError(
      "INVALID_REQUEST",
      "classes and spacePt arrays are required",
    );
  }
  const peopleCount =
    classes.reduce(
      (sum: number, block: { rows?: unknown[] }) =>
        sum + (Array.isArray(block?.rows) ? block.rows.length : 0),
      0,
    ) + spacePt.length;
  if (peopleCount === 0) {
    throw new BadRequestError("INVALID_REQUEST", "The CSV has no people to import");
  }
  const io = req.app.get("io");
  const data = await SheetService.importDay({
    date,
    locationId,
    classes,
    spacePt,
    io,
  });
  new SuccessResponse("Sheet import processed", data).send(res);
});

