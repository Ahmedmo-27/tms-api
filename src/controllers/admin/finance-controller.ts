import { Request, Response } from "express";
import { Types } from "mongoose";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";
import { resolveLocationFilter } from "../../utils/location-scope";
import { buildFinanceRange } from "../../utils/finance-range";
import { FinanceService } from "../../services/finance-service";

const MAX_PAGE_SIZE = 10000;

function rangeFrom(req: Request) {
  return buildFinanceRange(req.query, resolveLocationFilter(req));
}

function paging(req: Request) {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? "25"), 10);
  const limit = Number.isNaN(rawLimit) ? 25 : Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page, limit };
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export const getFinanceOverview = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.overview(rangeFrom(req));
  new SuccessResponse("Finance overview fetched", data).send(res);
});

export const getFinanceSales = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.sales(rangeFrom(req), {
    ...paging(req),
    segment: text(req.query.segment),
    search: text(req.query.search),
  });
  new SuccessResponse("Finance sales fetched", data).send(res);
});

export const getFinanceCoachHours = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.coachHours(rangeFrom(req));
  new SuccessResponse("Coach hours fetched", data).send(res);
});

export const getFinanceClassDetail = asyncHandler(async (req: Request, res: Response) => {
  const classTitle = typeof req.query.classTitle === "string" ? req.query.classTitle.trim() : "";
  if (!classTitle || classTitle.length > 200) {
    throw new BadRequestError("INVALID_CLASS", "A class title is required");
  }
  const allTime = req.query.allTime === "1" || req.query.allTime === "true";
  const range = allTime
    ? await FinanceService.classAllTimeRange(classTitle, resolveLocationFilter(req))
    : rangeFrom(req);
  const data = await FinanceService.classDetail(range, classTitle);
  new SuccessResponse("Class detail fetched", { ...data, allTime }).send(res);
});

export const getFinanceClassDay = asyncHandler(async (req: Request, res: Response) => {
  const classTitle = typeof req.query.classTitle === "string" ? req.query.classTitle.trim() : "";
  if (!classTitle || classTitle.length > 200) {
    throw new BadRequestError("INVALID_CLASS", "A class title is required");
  }
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestError("INVALID_DATE", "A date in yyyy-MM-dd format is required");
  }
  const data = await FinanceService.classDay(classTitle, date, resolveLocationFilter(req));
  new SuccessResponse("Class day fetched", data).send(res);
});

export const getFinanceCoachUsage = asyncHandler(async (req: Request, res: Response) => {
  const { coachId } = req.params;
  if (!coachId || !Types.ObjectId.isValid(coachId)) {
    throw new BadRequestError("INVALID_ID", "Invalid coach ID");
  }
  const data = await FinanceService.coachPackageUsage(rangeFrom(req), coachId);
  new SuccessResponse("Coach package usage fetched", data).send(res);
});

export const getFinanceCoaches = asyncHandler(async (_req: Request, res: Response) => {
  const data = await FinanceService.coaches();
  new SuccessResponse("Coaches fetched", data).send(res);
});

export const getFinancePt = asyncHandler(async (req: Request, res: Response) => {
  const rawPtType = req.query.ptType;
  const ptType = rawPtType === "online" || rawPtType === "mindspace" ? rawPtType : "all";
  const data = await FinanceService.ptAnalytics(rangeFrom(req), ptType);
  new SuccessResponse("PT analytics fetched", data).send(res);
});

export const getFinanceDeferred = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.deferredRevenue(rangeFrom(req));
  new SuccessResponse("Deferred revenue fetched", data).send(res);
});

export const getFinanceBranches = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.branches(rangeFrom(req));
  new SuccessResponse("Branch comparison fetched", data).send(res);
});

export const getFinanceRetention = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.retention(rangeFrom(req));
  new SuccessResponse("Retention fetched", data).send(res);
});

export const getFinanceLedger = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.ledger(rangeFrom(req), {
    ...paging(req),
    search: text(req.query.search),
    method: text(req.query.method),
    type: text(req.query.type),
    flaggedOnly: req.query.flaggedOnly === "true",
  });
  new SuccessResponse("Ledger fetched", data).send(res);
});

export const getFinanceRefunds = asyncHandler(async (req: Request, res: Response) => {
  const data = await FinanceService.refunds(rangeFrom(req));
  new SuccessResponse("Refunds fetched", data).send(res);
});
