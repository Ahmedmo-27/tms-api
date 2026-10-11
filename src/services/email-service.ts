import { InternalError } from "../core/ApiError";
import logger from "../config/logger";
import { Resend } from "resend";
import User from "../models/user";
import Location from "../models/location";
import { Types } from "mongoose";

export const sendPasswordResetEmail = async (
  email: string,
  resetCode: string
) => {
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const user = process.env.EMAIL_USER;
    if(!user) throw new InternalError("EMAIL_USER_NOT_DEFINED", "EMAIL_USER is not defined in environment variables")    
    const { data, error } = await resend.emails.send({
      from: user, // must be a verified domain or sender in Resend
      to: email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
          <h1>Password Reset Code</h1>
          <p>Please use the code below to reset your password:</p>
          <div style="font-size: 24px; font-weight: bold; color: #32500A; background: #f1f3f5; padding: 12px; border-radius: 8px; display: inline-block; margin-top: 20px;">
            ${resetCode}
          </div>
          <p style="margin-top: 24px;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      logger.error("Error sending password reset email", {
        error,
        email,
      });
      throw new InternalError("SMTP_ERROR", "Failed to send password reset email");
    }

    logger.info(`Password reset email sent to ${email}`);
    return data;
  } catch (err) {
    logger.error("Resend exception", { error: (err as Error).message });
    throw new InternalError("SMTP_ERROR", "Failed to send password reset email");
  }
};

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ] as string)
  );

export const TICKET_EMAIL_SENDER_NAME = "The Mind Space";
export const TICKET_EMAIL_SENDER_ADDRESS = "admin@the-mind-spcae.com";

export function getTicketEmailSender(): string {
  const senderName = process.env.TICKET_SENDER_NAME || TICKET_EMAIL_SENDER_NAME;
  const senderEmail = process.env.TICKET_SENDER_EMAIL || TICKET_EMAIL_SENDER_ADDRESS;
  return `${senderName} <${senderEmail}>`;
}

// Best-effort confirmation email for a submitted support ticket.
// Skips silently if email isn't configured (e.g. FILL_IN placeholders) and never throws,
// so a failed/unconfigured email can't break ticket submission.
export const sendTicketConfirmationEmail = async (
  email: string,
  name: string,
  category: string
) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || apiKey === "FILL_IN") {
    logger.info("Skipping ticket confirmation email - email not configured");
    return;
  }

  const fromSender = getTicketEmailSender();

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: fromSender,
      to: email,
      subject: "We received your request - The Mind Space",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1a1a1a;">
          <h2>Hi ${escapeHtml(name)},</h2>
          <p>Thanks for reaching out. We've received your request about
            <strong>${escapeHtml(category)}</strong> and our team will get back to you soon.</p>
          <p style="margin-top: 24px; color: #6b7280;">— The Mind Space Team</p>
        </div>
      `,
    });
    if (error) {
      logger.error("Error sending ticket confirmation email", { error, email });
      return;
    }
    logger.info(`Ticket confirmation email sent to ${email}`);
  } catch (err) {
    logger.error("Resend exception (ticket confirmation)", {
      error: (err as Error).message,
    });
  }
};

export interface NewTicketNotificationData {
  _id?: unknown;
  id?: unknown;
  name: string;
  email: string;
  phone?: string;
  category: string;
  otherDetails?: string;
  description: string;
  locationId?: unknown;
  creatorRole?: string;
  creatorName?: string;
  createdAt?: unknown;
}

function renderManagementTicketEmailHtml(
  recipientName: string,
  ticket: NewTicketNotificationData,
  branchName?: string,
  formattedDate?: string,
  ticketIdStr?: string
): string {
  const isOther = ticket.category?.toLowerCase() === "other";
  const displayId = ticketIdStr || "N/A";
  const displayDate = formattedDate || new Date().toUTCString();

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; color: #1f2937;">
      <div style="background-color: #32500A; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">The Mind Space</h1>
        <p style="color: #d1fae5; margin: 6px 0 0 0; font-size: 14px;">Support Ticket Notification</p>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 16px; margin: 0 0 16px 0;">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px 0; color: #374151;">
          A new support ticket has been submitted and requires management review:
        </p>

        <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280; width: 140px; font-weight: 500;">Ticket ID:</td>
              <td style="padding: 6px 0; color: #111827; font-family: monospace; font-weight: 600;">${escapeHtml(displayId)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Category:</td>
              <td style="padding: 6px 0; color: #111827; font-weight: 600;">${escapeHtml(ticket.category || "General")}</td>
            </tr>
            ${
              isOther && ticket.otherDetails
                ? `<tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Category Detail:</td>
              <td style="padding: 6px 0; color: #111827;">${escapeHtml(ticket.otherDetails)}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Submitted By:</td>
              <td style="padding: 6px 0; color: #111827;">
                ${escapeHtml(ticket.name)}
                <span style="display: inline-block; background-color: #e5e7eb; color: #374151; font-size: 12px; padding: 2px 8px; border-radius: 12px; margin-left: 6px; text-transform: capitalize;">${escapeHtml(ticket.creatorRole || "member")}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Email:</td>
              <td style="padding: 6px 0; color: #111827;"><a href="mailto:${escapeHtml(ticket.email)}" style="color: #32500A; text-decoration: none;">${escapeHtml(ticket.email)}</a></td>
            </tr>
            ${
              ticket.phone
                ? `<tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Phone:</td>
              <td style="padding: 6px 0; color: #111827;"><a href="tel:${escapeHtml(ticket.phone)}" style="color: #32500A; text-decoration: none;">${escapeHtml(ticket.phone)}</a></td>
            </tr>`
                : ""
            }
            ${
              branchName
                ? `<tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Branch:</td>
              <td style="padding: 6px 0; color: #111827;">${escapeHtml(branchName)}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Submitted At:</td>
              <td style="padding: 6px 0; color: #111827;">${escapeHtml(displayDate)}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 14px; font-weight: 600; color: #374151; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Description</h3>
          <div style="background-color: #ffffff; border-left: 4px solid #32500A; border-top: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; border-radius: 0 6px 6px 0; padding: 14px 16px; font-size: 14px; line-height: 1.6; color: #1f2937; white-space: pre-wrap;">${escapeHtml(ticket.description)}</div>
        </div>

        <p style="font-size: 13px; color: #6b7280; margin: 24px 0 0 0; line-height: 1.5;">
          You can manage and update the status of this ticket from the <strong>Support Tickets</strong> section in the management dashboard.
        </p>
      </div>
      <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        &copy; The Mind Space. All rights reserved.
      </div>
    </div>
  `;
}

// Sends an email notification to all management/admin users when a new ticket is created.
// Skips silently if email service is unconfigured and catches errors gracefully.
export const sendNewTicketManagementNotificationEmail = async (
  ticket: NewTicketNotificationData
) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || apiKey === "FILL_IN") {
    logger.info("Skipping management ticket notification email - email not configured");
    return;
  }

  const ticketIdStr = ticket._id != null ? String(ticket._id) : (ticket.id != null ? String(ticket.id) : "");
  const fromSender = getTicketEmailSender();

  try {
    // 1. Query all management and admin users
    const managementUsers = await User.find({
      role: { $in: ["management", "admin"] },
      email: { $exists: true, $ne: "" },
    })
      .select("name email role")
      .lean();

    const emailRegex = /^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,}$/;
    const seenEmails = new Set<string>();
    const recipients: Array<{ name: string; email: string }> = [];

    for (const u of managementUsers) {
      const normalizedEmail = (u.email || "").trim().toLowerCase();
      if (
        normalizedEmail &&
        emailRegex.test(normalizedEmail) &&
        !seenEmails.has(normalizedEmail)
      ) {
        seenEmails.add(normalizedEmail);
        recipients.push({
          name: (u.name || "").trim() || "Management Team",
          email: normalizedEmail,
        });
      }
    }

    if (recipients.length === 0) {
      logger.warn(
        "No management users with valid email found to notify for new ticket",
        { ticketId: ticketIdStr }
      );
      return;
    }

    // 2. Optionally resolve branch name if locationId is present
    let branchName: string | undefined;
    if (ticket.locationId && Types.ObjectId.isValid(String(ticket.locationId))) {
      try {
        const loc = await Location.findById(ticket.locationId as any).select("branchName").lean();
        if (loc?.branchName) {
          branchName = loc.branchName;
        }
      } catch (err) {
        logger.warn("Failed to resolve branch name for ticket notification", {
          locationId: String(ticket.locationId),
          error: (err as Error).message,
        });
      }
    }

    // 3. Format date
    let formattedDate: string;
    try {
      const createdDate =
        ticket.createdAt instanceof Date
          ? ticket.createdAt
          : typeof ticket.createdAt === "string" || typeof ticket.createdAt === "number"
          ? new Date(ticket.createdAt)
          : new Date();

      formattedDate = createdDate.toLocaleString("en-US", {
        timeZone: "Africa/Cairo",
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      formattedDate = new Date().toUTCString();
    }

    // 4. Send emails to management users
    const resend = new Resend(apiKey);
    const subject = `[New Ticket] ${ticket.category} - ${ticket.name}`;

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const html = renderManagementTicketEmailHtml(
          recipient.name,
          ticket,
          branchName,
          formattedDate,
          ticketIdStr
        );
        const { error } = await resend.emails.send({
          from: fromSender,
          to: recipient.email,
          subject,
          html,
        });
        if (error) {
          logger.error("Error sending new ticket email to management user", {
            error,
            email: recipient.email,
            ticketId: ticketIdStr,
          });
          throw error;
        }
        logger.info(
          `New ticket notification email sent to management user: ${recipient.email}`
        );
      })
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    logger.info(
      `New ticket notification dispatched to management (${successCount}/${recipients.length} successful)`,
      {
        ticketId: ticketIdStr,
        recipientsCount: recipients.length,
      }
    );
  } catch (err) {
    logger.error("Resend exception (management ticket notification)", {
      ticketId: ticketIdStr,
      error: (err as Error).message,
    });
  }
};

