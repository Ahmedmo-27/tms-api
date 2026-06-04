import asyncHandler from "../../utils/asyncHandler";
import { AuthRequest } from "../../middlewares/auth.middleware";
import User from "../../models/user";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { Request, Response } from "express";
import { SuccessResponse } from "../../core/ApiResponse";
import { NotificationsService } from "../../services/notifications-service";

export const sendCustomNotification = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { title, body, userId } = req.body;
  if (!title || title === "")
    throw new BadRequestError("INVALID_TITLE", "No title provided");
  if (!body || body == "")
    throw new BadRequestError("INVLAID_BODY", "No body provided");
  const user = User.findById(userId);
  if (!user) throw new NotFoundError("USER_NOT_FOUND", "User was not found");
  NotificationsService.sendNotification([userId], title, body);
  new SuccessResponse("Notification Sent").send(res);
});

export const updateFcmToken = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const fcmToken = req.params.token;
  if (fcmToken === "" || !fcmToken)
    throw new BadRequestError("INVALID_FCM_TOKEN", "No token provided");
  const authReq = req as AuthRequest;
  const user = await User.findById(authReq.user._id);
  if (!user) throw new NotFoundError("USER_NOT_FOUND", "User was not found");
  if (!user.fcmTokens.includes(fcmToken)) {
    user.fcmTokens.push(fcmToken);
    await user.save();
  }
  new SuccessResponse("FCM token updated").send(res);
});

export const removeFcmToken = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const fcmToken = req.params.token;
  if (fcmToken === "" || !fcmToken)
    throw new BadRequestError("INVALID_FCM_TOKEN", "No token provided");
  const authReq = req as AuthRequest;
  const user = await User.findById(authReq.user._id);
  if (!user) throw new NotFoundError("USER_NOT_FOUND", "User was not found");
  if (!user.fcmTokens.includes(fcmToken)) {
    throw new BadRequestError("INVALID_FCM_TOKEN", "Token is not valid");
  }
  user.fcmTokens.filter((token) => token != fcmToken);
  await user.save();
  new SuccessResponse("FCM token updated").send(res);
});
