import asyncHandler from "../../utils/asyncHandler";
import Order from "../../models/order";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { OrdersService } from "../../services/orders-service";
import { BadRequestError } from "../../core/ApiError";
import { resolveLocationFilter, resolveLocationIdForWrite, locationIdScalarQuery, toObjectId } from "../../utils/location-scope";
import { buildCairoDateRangeQuery } from "../../utils/date-range-query";

export const getOrders = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const query: any = {};
  const memberId = req.query.memberId as string;
  if (memberId) {
    query.memberId = memberId;
  }
  const targetLocationId = resolveLocationFilter(req);
  if (targetLocationId) {
    Object.assign(query, locationIdScalarQuery(targetLocationId));
  }

  const date = (req.query.date as string | undefined)?.trim();
  const startDate = ((req.query.startDate || req.query.from) as string | undefined)?.trim();
  const endDate = ((req.query.endDate || req.query.to) as string | undefined)?.trim();

  const dateQuery = buildCairoDateRangeQuery(
    "createdAt",
    date,
    undefined,
    undefined,
    startDate,
    endDate
  );
  Object.assign(query, dateQuery);

  let ordersQuery = Order.find(query)
    .populate("locationId", "branchName location")
    .sort({ createdAt: -1 });

  const hasDateFilter = Object.keys(dateQuery).length > 0;
  if (!hasDateFilter && !memberId) {
    ordersQuery = ordersQuery.limit(200);
  }

  const orders = await ordersQuery;
  new SuccessResponse("Orders Found!", orders).send(res);
});

export const createOrder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { memberId, memberName, items, totalAmount, paymentMethod, note } = req.body;
  if (!items || items.length === 0) {
    throw new BadRequestError("INVALID_REQUEST", "Items are required");
  }
  const targetLocationId = resolveLocationIdForWrite(req);
  const order = new Order({
    memberId,
    memberName,
    items,
    totalAmount,
    paymentMethod,
    note,
    locationId: toObjectId(targetLocationId) ?? undefined,
  });
  await order.save();
  new SuccessResponse("Order Created!", order).send(res);
});

export const deleteOrder = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const id = req.params.orderId;
  await OrdersService.deleteOrder(id)
  new SuccessResponse("Order Deleted!").send(res);
});
