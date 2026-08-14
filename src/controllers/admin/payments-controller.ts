import asyncHandler from "../../utils/asyncHandler";
import { Request, Response } from "express";
import { SuccessResponse } from "../../core/ApiResponse";
import { PaymentsService } from "../../services/payments-service";
import { ForbiddenError, InternalError } from "../../core/ApiError";
import { resolveLocationFilter } from "../../utils/location-scope";

export const getPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const date = req.query.date;
    const month = req.query.month;
    const year = req.query.year;
    const targetLocationId = resolveLocationFilter(req);

    const payments = await PaymentsService.getPayments(
      date as string,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
      targetLocationId
    );
    new SuccessResponse("Fetched Payments!", payments).send(res);
  }
);

/**
 * Legacy external payments endpoint (not mounted by default).
 * Requires EXPOSED_PAYMENTS_API_KEY from environment — never hardcode keys.
 */
export const exposedGetPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const expectedKey = process.env.EXPOSED_PAYMENTS_API_KEY;
    if (!expectedKey) {
      throw new InternalError(
        "API_KEY_NOT_CONFIGURED",
        "Exposed payments API key is not configured",
      );
    }

    const key = req.query.key;
    const date = req.query.date;
    const month = req.query.month;
    const year = req.query.year;
    if (key !== expectedKey) {
      throw new ForbiddenError("INVALID_API_KEY", "Please provide a valid API key");
    }

    if (
      (year && year !== "" && year !== "2025") ||
      (month && year === "2025" && Number(month) < 11) ||
      (date && new Date(date as string) < new Date("11/1/2025"))
    ) {
      throw new ForbiddenError(
        "INVALID_DATE",
        "Please provide a valid date starting November 2025",
      );
    }

    const payments = await PaymentsService.getExposedPayments(
      date as string,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined
    );
    new SuccessResponse("Fetched Payments!", payments).send(res);
  }
);
