import asyncHandler from "../../utils/asyncHandler";
import Order from "../../models/order";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { OrdersService } from "../../services/orders-service";
import { BadRequestError } from "../../core/ApiError";

export const getOrders = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const query: any = {};
  const memberId = req.query.memberId as string;
  if (memberId) {
    query.memberId = memberId;
  }
  const userRole = (req as any).user.role;
  const userLocationId = (req as any).user.locationId;
  if ((userRole === "branch_admin" || userRole === "fd") && userLocationId) {
    query.locationId = userLocationId;
  } else {
    const queryLocationId = req.query.locationId as string;
    if (userRole === "management" && queryLocationId) {
      query.locationId = queryLocationId;
    }
  }
  const orders = await Order.find(query).sort({ createdAt: -1 });
  new SuccessResponse("Orders Found!", orders).send(res);
});

export const createOrder = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { memberId, memberName, items, totalAmount, paymentMethod, note, locationId } = req.body;
  if (!items || items.length === 0) {
    throw new BadRequestError("INVALID_REQUEST", "Items are required");
  }
  const userRole = (req as any).user.role;
  let targetLocationId = locationId;
  if (userRole === "branch_admin" || userRole === "fd") {
    targetLocationId = (req as any).user.locationId?.toString();
  }
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
