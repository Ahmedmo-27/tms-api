import asyncHandler from "../../utils/asyncHandler";
import { Request, Response } from "express";
import { SuccessResponse } from "../../core/ApiResponse";
import { PaymentsService } from "../../services/payments-service";
import logger from "../../config/logger";
import { ForbiddenError } from "../../core/ApiError";

export const getPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const date = req.query.date;
    const month = req.query.month;
    const year = req.query.year;
    const payments = await PaymentsService.getPayments(
      date as string,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined
    );
    new SuccessResponse("Fetched Payments!", payments).send(res);
  }
);

export const exposedGetPayments = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const key = req.query.key;
    const date = req.query.date;
    const month = req.query.month;
    const year = req.query.year;
    if(key !== "a2LtbarGQY2ZUlStrLnvzRAXsFSlhkd2") throw new ForbiddenError("INVALID_API_KEY", "Please provide a valid API key")

    if ((year && year !== "" && year !== "2025") || (month && year === "2025" && Number(month) < 11) || (date && new Date(date as string) < new Date("11/1/2025"))) {
      throw new ForbiddenError("INVALID_DATE", "Please provide a valid date starting November 2025");
    }


    const payments = await PaymentsService.getExposedPayments(
      date as string,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined
    );
    new SuccessResponse("Fetched Payments!", payments).send(res);
  }
);