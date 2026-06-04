import asyncHandler from "../../utils/asyncHandler";
import Order from "../../models/order";
import { SuccessResponse } from "../../core/ApiResponse";
import { Request, Response } from "express";
import { OrdersService } from "../../services/orders-service";

export const getOrders = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const orders = await Order.find();
  new SuccessResponse("Orders Found!", orders).send(res);
});

export const createOrder = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const cart = req.body;
  const order = await OrdersService.saveOrder(cart)
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
