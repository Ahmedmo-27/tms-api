import { Request, Response } from "express";
import EmailLog from "../../models/emailLog";
import ReceivedEmail from "../../models/receivedEmail";
import Member from "../../models/member";
import User from "../../models/user";
import logger from "../../config/logger";
import { sendTransactionalEmailBatch } from "../../services/brevo-mail-service";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError, InternalError } from "../../core/ApiError";

export const sendMail = asyncHandler(async (req: Request, res: Response) => {
  const { mode, subject, body, to, attachment } = req.body;
  const adminId = (req as any).user?._id;

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

    const coaches = await User.find({ role: "coach" }).select("email");
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
    const coaches = await User.find({ role: "coach" }).select("email");
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
  });
  await emailLog.save();

  new SuccessResponse("Mail sent!", { sent: recipients.length }).send(res);
});

export const getLogs = asyncHandler(async (req: Request, res: Response) => {
  const logs = await EmailLog.find().sort({ sent_at: -1 }).limit(100);
  new SuccessResponse("Mail logs fetched!", logs).send(res);
});

export const getInbox = asyncHandler(async (req: Request, res: Response) => {
  const emails = await ReceivedEmail.find().sort({ date: -1 }).limit(100);
  new SuccessResponse("Inbox fetched!", emails).send(res);
});
