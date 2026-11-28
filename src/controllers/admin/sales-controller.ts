import { Request, Response } from "express";
import * as XLSX from "xlsx";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";
import {
  getAssignedBranchLocationId,
  resolveLocationFilter,
} from "../../utils/location-scope";
import { SalesService } from "../../services/sales-service";
import { startOfDateCairo, cairoDayRange } from "../../utils/timezone";
import { buildSalesmanPaymentsExport } from "../../services/salesman-payments-export";

const MAX_PAGE_SIZE = 200;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const listSalesAccounts = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const accounts = await SalesService.listSalesAccounts();
    new SuccessResponse("Sales accounts fetched", { accounts }).send(res);
  },
);

export const listSoldPackages = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit ?? "25"), 10);
    const limit = Number.isNaN(rawLimit)
      ? 25
      : Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));

    const data = await SalesService.listSoldPackages({
      // branch_admin is pinned to its own branch; management and sales_manager
      // may pass ?locationId= or see every branch.
      locationId: resolveLocationFilter(req),
      search: text(req.query.search),
      startDate: text(req.query.startDate),
      endDate: text(req.query.endDate),
      seller: text(req.query.seller),
      page,
      limit,
    });

    new SuccessResponse("Sold packages fetched", data).send(res);
  },
);

export const assignMemberSalesRep = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { uid } = req.params;
    const rawSeller =
      req.body?.soldBy !== undefined ? req.body.soldBy : req.body?.salesRep;
    if (
      rawSeller !== null &&
      rawSeller !== undefined &&
      typeof rawSeller !== "string"
    ) {
      throw new BadRequestError(
        "INVALID_SALES_ACCOUNT",
        "soldBy must be a sales account id, or null to clear it",
      );
    }

    const actorId = String(
      (req as unknown as { user: { _id: unknown } }).user._id,
    );
    const data = await SalesService.assignMemberSalesRep({
      uid,
      soldBy: rawSeller ?? null,
      actorId,
      scopedLocationId: getAssignedBranchLocationId(req),
    });

    new SuccessResponse("Sales rep assigned to member", data).send(res);
  },
);

export const assignSoldPackageSeller = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { memberPackageId } = req.params;
    const { soldBy } = req.body ?? {};
    if (soldBy !== null && soldBy !== undefined && typeof soldBy !== "string") {
      throw new BadRequestError(
        "INVALID_SALES_ACCOUNT",
        "soldBy must be a sales account id, or null to clear it",
      );
    }

    const actorId = String((req as unknown as { user: { _id: unknown } }).user._id);
    const data = await SalesService.assignSeller({
      memberPackageId,
      soldBy: soldBy ?? null,
      actorId,
      scopedLocationId: getAssignedBranchLocationId(req),
    });

    new SuccessResponse("Sales attribution saved", data).send(res);
  },
);

export const exportSalesmanPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
      throw new BadRequestError(
        "INVALID_DATE_RANGE",
        "startDate and endDate must be provided in YYYY-MM-DD format",
      );
    }

    const start = startOfDateCairo(startDate);
    const { end } = cairoDayRange(endDate);
    if (start >= end) {
      throw new BadRequestError(
        "INVALID_DATE_RANGE",
        "startDate must be before or equal to endDate",
      );
    }

    const { workbook } = await buildSalesmanPaymentsExport({
      startDate: start,
      endDate: end,
      sheetName: "Salesman Payments",
    });

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="salesman-payments-${startDate}-to-${endDate}.xlsx"`,
    );
    res.status(200).send(buffer);
  },
);
