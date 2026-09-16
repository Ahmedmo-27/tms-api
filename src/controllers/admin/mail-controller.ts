import { Request, Response } from "express";
import EmailLog from "../../models/emailLog";
import ReceivedEmail from "../../models/receivedEmail";
import Member from "../../models/member";
import User from "../../models/user";
import logger from "../../config/logger";
import { sendTransactionalEmailBatch } from "../../services/brevo-mail-service";
import { syncEmails } from "../../services/imap-service";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, InternalError, NotFoundError } from "../../core/ApiError";
import { getUserMailConfig } from "../../utils/mail-helper";

export const sendMail = asyncHandler(async (req: Request, res: Response) => {
  const { mode, subject, body, to, attachment } = req.body;
  const user = (req as any).user;
  const adminId = user?._id;
  const { email: senderEmail, name: senderName } = getUserMailConfig(user);

  if (!subject || !body) {
    throw new BadRequestError("INVALID_REQUEST", "subject and body are required");
  }

  let recipients: string[] = [];

  if (mode === "broadcast") {
    const activeMembers = await Member.find({ isActive: true }).populate({
      path: "uid",
      select: "email",
    });
    const memberEmails = activeMembers
      .map((m: any) => m.uid?.email)
      .filter((email) => email);

    const coaches = await User.find({ role: { $in: ["coach", "managing_coach"] } }).select("email");
    const coachEmails = coaches.map((c: any) => c.email).filter((e: string) => e);

    recipients = [...new Set([...memberEmails, ...coachEmails])];
  } else if (mode === "members") {
    const activeMembers = await Member.find({ isActive: true }).populate({
      path: "uid",
      select: "email",
    });
    recipients = activeMembers
      .map((m: any) => m.uid?.email)
      .filter((email) => email);
  } else if (mode === "coaches") {
    const coaches = await User.find({ role: { $in: ["coach", "managing_coach"] } }).select("email");
    recipients = coaches.map((c: any) => c.email).filter((e: string) => e);
  } else if (mode === "manual") {
    recipients = Array.isArray(to) ? to : [];
  } else {
    throw new BadRequestError("INVALID_MODE", "Invalid mail mode");
  }

  if (!recipients.length) {
    throw new BadRequestError("NO_RECIPIENTS", "No recipients found.");
  }

  try {
    await sendTransactionalEmailBatch({
      recipients,
      subject,
      htmlContent: body,
      attachment,
      sender: { email: senderEmail, name: senderName },
      replyTo: { email: senderEmail, name: senderName },
    });
  } catch (error: any) {
    logger.error("Error sending mail:", error);
    const emailLog = new EmailLog({
      mode,
      subject,
      body,
      recipients: mode === "manual" ? recipients : recipients.length,
      sent_at: new Date(),
      status: "failed",
      error_msg: error.message || "Unknown error",
      sent_by: adminId,
      sender_email: senderEmail,
      sender_name: senderName,
    });
    await emailLog.save();
    throw new InternalError("MAIL_SEND_FAILED", "Failed to send email");
  }

  const emailLog = new EmailLog({
    mode,
    subject,
    body,
    recipients: mode === "manual" ? recipients : recipients.length,
    sent_at: new Date(),
    status: "sent",
    sent_by: adminId,
    sender_email: senderEmail,
    sender_name: senderName,
  });
  await emailLog.save();

  new SuccessResponse("Mail sent!", { sent: recipients.length }).send(res);
});

export const getUserEmails = (user: any): string[] => {
  if (!user) return [];
  const emails: string[] = [];
  if (user.tmsEmail && typeof user.tmsEmail === "string") {
    emails.push(user.tmsEmail.trim().toLowerCase());
  }
  if (user.email && typeof user.email === "string") {
    emails.push(user.email.trim().toLowerCase());
  }
  const config = getUserMailConfig(user);
  if (config.email && typeof config.email === "string") {
    emails.push(config.email.trim().toLowerCase());
  }
  return [...new Set(emails.filter(Boolean))];
};

export const getInboxFilter = (user: any) => {
  if (!user) return { _id: null };

  const userEmails = getUserEmails(user);
  const orConditions: any[] = [];

  if (user._id) {
    orConditions.push({ recipientUser: user._id });
  }

  if (userEmails.length > 0) {
    orConditions.push({ recipientEmail: { $in: userEmails } });

    for (const email of userEmails) {
      const escapedMail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      orConditions.push({
        to: {
          $regex: `(?:^|[^a-zA-Z0-9._%+-])${escapedMail}(?:$|[^a-zA-Z0-9._%+-])`,
          $options: "i",
        },
      });
    }
  }

  return orConditions.length > 0 ? { $or: orConditions } : { _id: null };
};

export const getLogs = asyncHandler(async (req: Request, res: Response) => {
  const adminId = (req as any).user?._id;
  const filter: any = adminId ? { sent_by: adminId } : {};

  const { page, limit, search, mode, status } = req.query;

  const conditions: any[] = [];
  if (Object.keys(filter).length > 0) {
    conditions.push(filter);
  }

  if (mode && typeof mode === "string" && mode !== "all") {
    conditions.push({ mode: mode.trim() });
  }

  if (status && typeof status === "string" && status !== "all") {
    conditions.push({ status: status.trim() });
  }

  if (search && typeof search === "string" && search.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    conditions.push({
      $or: [{ subject: rx }, { mode: rx }, { body: rx }],
    });
  }

  const query = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : { $and: conditions }) : {};

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const total = await EmailLog.countDocuments(query);
  const logs = await EmailLog.find(query)
    .sort({ sent_at: -1 })
    .skip(skip)
    .limit(limitNum);

  const totalPages = Math.ceil(total / limitNum) || 1;

  new SuccessResponse("Mail logs fetched!", {
    logs,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
  }).send(res);
});

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const filter = getInboxFilter(user);

  const { page, limit, search, status } = req.query;

  const conditions: any[] = [filter];

  if (status === "unread") {
    conditions.push({ isRead: false });
  }

  if (search && typeof search === "string" && search.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    conditions.push({
      $or: [{ subject: rx }, { from: rx }, { text: rx }, { to: rx }],
    });
  }

  const query = conditions.length > 1 ? { $and: conditions } : filter;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const total = await ReceivedEmail.countDocuments(query);
  const emails = await ReceivedEmail.find(query)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limitNum);

  const totalPages = Math.ceil(total / limitNum) || 1;

  new SuccessResponse("Inbox fetched!", {
    emails,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
  }).send(res);
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const filter = getInboxFilter(user);
  const unreadCount = await ReceivedEmail.countDocuments({
    ...filter,
    isRead: false,
  });
  new SuccessResponse("Unread count fetched!", { unreadCount }).send(res);
});

export const markEmailAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    throw new BadRequestError("EMAIL_ID_REQUIRED", "Email ID is required");
  }

  const isRead = typeof req.body?.isRead === "boolean" ? req.body.isRead : true;

  const email = await ReceivedEmail.findByIdAndUpdate(
    id,
    { isRead },
    { new: true }
  );

  if (!email) {
    throw new NotFoundError("EMAIL_NOT_FOUND", "Email not found");
  }

  new SuccessResponse("Email marked as read!", email).send(res);
});

export const markAllEmailsRead = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const filter = getInboxFilter(user);

  const result = await ReceivedEmail.updateMany(
    { ...filter, isRead: false },
    { $set: { isRead: true } }
  );

  new SuccessResponse("All emails marked as read!", {
    modifiedCount: result.modifiedCount,
  }).send(res);
});

export const getMailProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const config = getUserMailConfig(user);
  new SuccessResponse("Mail profile fetched!", {
    email: config.email,
    name: config.name,
    tmsEmail: user?.tmsEmail || null,
    sendAsName: user?.sendAsName || null,
  }).send(res);
});

export const triggerSync = asyncHandler(async (req: Request, res: Response) => {
  await syncEmails();
  const user = (req as any).user;
  const filter = getInboxFilter(user);

  const pageNum = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const total = await ReceivedEmail.countDocuments(filter);
  const emails = await ReceivedEmail.find(filter)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limitNum);

  const totalPages = Math.ceil(total / limitNum) || 1;

  new SuccessResponse("Inbox synced successfully!", {
    emails,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
  }).send(res);
});
