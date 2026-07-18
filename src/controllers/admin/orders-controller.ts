import asyncHandler from "../../utils/asyncHandler";
import Order from "../../models/order";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { OrdersService } from "../../services/orders-service";
import { BadRequestError } from "../../core/ApiError";
import { resolveLocationFilter, resolveLocationIdForWrite } from "../../utils/location-scope";

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
    query.locationId = targetLocationId;
  }
  const orders = await Order.find(query)
    .populate("locationId", "branchName location")
    .sort({ createdAt: -1 });
  new SuccessResponse("Orders Found!", orders).send(res);
});

export const createOrder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { memberId, memberName, items, totalAmount, paymentMethod, note } = req.body;
  if (!items || items.length === 0) {
    throw new BadRequestError("INVALID_REQUEST", "Items are required");
  }
  const targetLocationId = resolveLocationIdForWrite(req);
  const order = new Order({ memberId, memberName, items, totalAmount, paymentMethod, note, locationId: targetLocationId });
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
