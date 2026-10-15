import asyncHandler from "../../utils/asyncHandler";
import { AuthRequest } from "../../middlewares/auth.middleware";
import User from "../../models/user";
import NotificationLog, {
  NotificationCategory,
  NotificationTargetType,
} from "../../models/notificationLog";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { Request, Response } from "express";
import { SuccessResponse } from "../../core/ApiResponse";
import { NotificationsService } from "../../services/notifications-service";
import admin from "../../config/firebase";
import logger from "../../config/logger";
import { Types } from "mongoose";

const DEFAULT_NOTIFICATION_TITLE = "THE MIND SPACE.";

/**
 * Dispatch notifications to a target audience or selected users
 */
export const sendNotificationBatch = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const {
    title,
    body,
    category = "GENERAL",
    targetType = "custom",
    locationId,
    userIds,
    data,
  } = req.body;

  const finalTitle = (title?.trim() || DEFAULT_NOTIFICATION_TITLE);

  if (!body || body.trim() === "") {
    throw new BadRequestError("INVALID_BODY", "Message body is required");
  }

  // Build user query based on audience target
  const userFilter: any = {};

  if (targetType === "custom") {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw new BadRequestError(
        "INVALID_RECIPIENTS",
        "At least one recipient user ID must be provided for direct targeting"
      );
    }
    const validIds = userIds.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new BadRequestError("INVALID_RECIPIENTS", "No valid user IDs provided");
    }
    userFilter._id = { $in: validIds.map((id) => new Types.ObjectId(id)) };
  } else if (targetType === "members") {
    userFilter.role = "member";
  } else if (targetType === "coaches") {
    userFilter.role = { $in: ["coach", "managing_coach"] };
  } else if (targetType === "branch") {
    if (!locationId || !Types.ObjectId.isValid(locationId)) {
      throw new BadRequestError("INVALID_LOCATION", "Valid branch locationId is required");
    }
    userFilter.locationId = new Types.ObjectId(locationId);
  } else if (targetType === "all") {
    // Target all app users
  } else {
    throw new BadRequestError("INVALID_TARGET_TYPE", "Invalid audience target type");
  }

  // Find recipients with tokens
  const users = await User.find(userFilter).select("_id name fcmTokens").lean();

  const recipientObjectIds = users.map((u) => u._id);
  const allTokens = [
    ...new Set(
      users
        .flatMap((u) => u.fcmTokens ?? [])
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    ),
  ];

  let deliveryStatus: "sent" | "partial" | "failed" = "sent";

  // Dispatch FCM push notifications if tokens exist
  if (allTokens.length > 0) {
    try {
      await NotificationsService.sendNotification(
        allTokens,
        finalTitle,
        body.trim(),
        data
      );
    } catch (fcmError) {
      logger.error("Failed to send FCM notifications in batch", fcmError);
      deliveryStatus = "partial";
    }
  } else {
    logger.warn("No FCM tokens found for target audience", {
      targetType,
      matchedUsers: users.length,
    });
  }

  // Mirror to Firebase Firestore 'notifications' collection for mobile in-app notifications
  if (admin.apps?.length) {
    try {
      const firestore = admin.firestore();
      if (targetType === "all" || targetType === "members") {
        await firestore.collection("notifications").add({
          to: "all",
          title: finalTitle,
          message: body.trim(),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        const batch = firestore.batch();
        const notifCol = firestore.collection("notifications");
        // Limit batch commits to Firebase Firestore limit (max 500)
        const batchRecipients = recipientObjectIds.slice(0, 450);
        for (const uid of batchRecipients) {
          const docRef = notifCol.doc();
          batch.set(docRef, {
            to: String(uid),
            title: finalTitle,
            message: body.trim(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        if (batchRecipients.length > 0) {
          await batch.commit();
        }
      }
    } catch (fsErr) {
      logger.warn("Firestore sync skipped or encountered error", {
        error: (fsErr as Error).message,
      });
    }
  }

  // Record audit log
  const senderId = authReq.user?._id
    ? new Types.ObjectId(String(authReq.user._id))
    : undefined;
  const senderName = authReq.user?.name || "Management";

  const logEntry = await NotificationLog.create({
    title: finalTitle,
    body: body.trim(),
    category: category as NotificationCategory,
    targetType: targetType as NotificationTargetType,
    locationId: locationId && Types.ObjectId.isValid(locationId) ? new Types.ObjectId(locationId) : undefined,
    recipientCount: users.length,
    recipientIds: targetType === "custom" ? recipientObjectIds : [],
    sentBy: senderId,
    sentByName: senderName,
    status: deliveryStatus,
    metadata: data || {},
    createdAt: new Date(),
  });

  new SuccessResponse("Notifications Dispatched Successfully", {
    logId: logEntry._id,
    matchedUsers: users.length,
    devicesReached: allTokens.length,
    status: deliveryStatus,
  }).send(res);
});

/**
 * Get paginated sent notification history
 */
export const getNotificationHistory = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { page = "1", limit = "20", search, category, targetType } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query: any = {};

  if (category && category !== "all") {
    query.category = category;
  }

  if (targetType && targetType !== "all") {
    query.targetType = targetType;
  }

  if (search && String(search).trim() !== "") {
    const term = String(search).trim();
    query.$or = [
      { title: { $regex: term, $options: "i" } },
      { body: { $regex: term, $options: "i" } },
      { sentByName: { $regex: term, $options: "i" } },
    ];
  }

  const [total, items] = await Promise.all([
    NotificationLog.countDocuments(query),
    NotificationLog.find(query)
      .populate("locationId", "branchName location")
      .populate("sentBy", "name email role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  new SuccessResponse("Notification History Retrieved", {
    items,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
  }).send(res);
});

/**
 * Get notification analytics & device reach stats
 */
export const getNotificationStats = asyncHandler(async function (
  _req: Request,
  res: Response
): Promise<void> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalSent, sentThisMonth, reachableUsersCount, aggregateRecipients] =
    await Promise.all([
      NotificationLog.countDocuments(),
      NotificationLog.countDocuments({ createdAt: { $gte: startOfMonth } }),
      User.countDocuments({ "fcmTokens.0": { $exists: true } }),
      NotificationLog.aggregate([
        {
          $group: {
            _id: null,
            totalRecipients: { $sum: "$recipientCount" },
          },
        },
      ]),
    ]);

  const totalRecipientsReached =
    aggregateRecipients.length > 0 ? aggregateRecipients[0].totalRecipients : 0;

  new SuccessResponse("Notification Stats Retrieved", {
    totalSent,
    sentThisMonth,
    reachableUsersCount,
    totalRecipientsReached,
  }).send(res);
});

/**
 * Legacy single-user custom notification endpoint
 */
export const sendCustomNotification = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const { title, body, userId } = req.body;
  const finalTitle = title?.trim() || DEFAULT_NOTIFICATION_TITLE;

  if (!body || body.trim() === "")
    throw new BadRequestError("INVALID_BODY", "No body provided");
  if (!userId)
    throw new BadRequestError("INVALID_USER_ID", "No userId provided");

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("USER_NOT_FOUND", "User was not found");

  await NotificationsService.notifyUsers([String(user._id)], finalTitle, body);

  // Record audit log
  await NotificationLog.create({
    title: finalTitle,
    body: body.trim(),
    category: "GENERAL",
    targetType: "custom",
    recipientCount: 1,
    recipientIds: [user._id],
    sentBy: authReq.user?._id
      ? new Types.ObjectId(String(authReq.user._id))
      : undefined,
    sentByName: authReq.user?.name || "Management",
    status: "sent",
    createdAt: new Date(),
  });

  new SuccessResponse("Notification Sent").send(res);
});

export const updateFcmToken = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const fcmToken = (req.params.fcmToken || req.params.token) as string;
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
  const fcmToken = (req.params.fcmToken || req.params.token) as string;
  if (fcmToken === "" || !fcmToken)
    throw new BadRequestError("INVALID_FCM_TOKEN", "No token provided");
  const authReq = req as AuthRequest;
  const user = await User.findById(authReq.user._id);
  if (!user) throw new NotFoundError("USER_NOT_FOUND", "User was not found");
  if (!user.fcmTokens.includes(fcmToken)) {
    throw new BadRequestError("INVALID_FCM_TOKEN", "Token is not valid");
  }
  user.fcmTokens = user.fcmTokens.filter((token) => token != fcmToken);
  await user.save();
  new SuccessResponse("FCM token updated").send(res);
});
