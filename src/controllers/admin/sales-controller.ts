import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";
import {
  getAssignedBranchLocationId,
  resolveLocationFilter,
} from "../../utils/location-scope";
import { SalesService } from "../../services/sales-service";

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
