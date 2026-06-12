import { Request, Response } from "express";
import nodemailer from "nodemailer";
import EmailLog from "../../models/emailLog";
import Member from "../../models/member";
import User from "../../models/user";
import logger from "../../config/logger";

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.MAIL_PORT || "587"),
  secure: process.env.MAIL_SECURE === "true",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_APP_PASSWORD,
  },
});

export const sendMail = async (req: Request, res: Response) => {
  const { mode, subject, body, to, attachment } = req.body;
  const adminId = (req as any).user?._id; // authenticateUser middleware sets this

  let recipients: string[] = [];

  try {
    if (mode === "broadcast") {
      const activeMembers = await Member.find({ isActive: true }).populate("uid");
      const memberEmails = activeMembers
        .map((m: any) => m.uid?.email)
        .filter((email) => email);

      const coaches = await User.find({ role: "coach" });
      const coachEmails = coaches.map((c: any) => c.email).filter(e => e);

      recipients = [...new Set([...memberEmails, ...coachEmails])];
    } else if (mode === "members") {
      const activeMembers = await Member.find({ isActive: true }).populate("uid");
      recipients = activeMembers
        .map((m: any) => m.uid?.email)
        .filter((email) => email);
    } else if (mode === "coaches") {
      const coaches = await User.find({ role: "coach" });
      recipients = coaches.map((c: any) => c.email).filter(e => e);
    } else if (mode === "manual") {
      recipients = to || [];
    }

    if (!recipients.length) {
      res.status(400).json({ success: false, error: "No recipients found." });
      return;
    }

    const mailOptions: any = {
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
      subject,
      html: body,
    };

    if (attachment) {
      mailOptions.attachments = [
        {
          filename: attachment.name || "attachment",
          content: attachment.data.includes("base64,") ? attachment.data.split("base64,")[1] : attachment.data,
          encoding: "base64",
        },
      ];
    }

    // Batch sending to avoid rate limits (50 per batch, 1000ms delay)
    const BATCH_SIZE = 50;
    const DELAY_MS = 1000;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      mailOptions.bcc = batch; // Use BCC to hide recipients from each other
      await transporter.sendMail(mailOptions);

      if (i + BATCH_SIZE < recipients.length) {
        await delay(DELAY_MS);
      }
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

    res.status(200).json({ success: true, sent: recipients.length });
  } catch (error: any) {
    logger.error("Error sending mail:", error);
    
    const emailLog = new EmailLog({
      mode,
      subject,
      body,
      recipients: mode === "manual" ? (to || []) : recipients.length,
      sent_at: new Date(),
      status: "failed",
      error_msg: error.message || "Unknown error",
      sent_by: adminId,
    });
    await emailLog.save();

    res.status(500).json({ success: false, error: error.message || "Failed to send email" });
  }
};

export const getLogs = async (req: Request, res: Response) => {
  try {
    const logs = await EmailLog.find().sort({ sent_at: -1 }).limit(100);
    res.status(200).json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
