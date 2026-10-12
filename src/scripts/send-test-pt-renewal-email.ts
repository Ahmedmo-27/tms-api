import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import nodemailer from "nodemailer";
import { Resend } from "resend";

async function main() {
  const targetEmail = "ahmedmostafa.swe1@gmail.com";
  console.log(`Preparing to send PT Package Renewal template test email to: ${targetEmail}`);

  const coachName = "Coach Ahmed";
  const memberName = "Sarah Connor";
  const memberPhone = "+20 101 234 5678";
  const packageName = "Personal Training - 12 Sessions";
  const sessionCount = 12;
  const startDateStr = new Date().toLocaleDateString("en-US", {
    timeZone: "Africa/Cairo",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const subject = `[TMS] PT Package Renewal: ${memberName} has renewed ${packageName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; color: #1f2937;">
      <div style="background-color: #32500A; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.5px;">The Mind Space</h1>
        <p style="color: #d1fae5; margin: 6px 0 0 0; font-size: 14px;">Personal Training Package Renewal</p>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 16px; margin: 0 0 16px 0;">Hi <strong>${coachName}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px 0; color: #374151;">
          Great news! Your client <strong>${memberName}</strong> has renewed their Personal Training package:
        </p>

        <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #6b7280; width: 140px; font-weight: 500;">Client Name:</td>
              <td style="padding: 6px 0; color: #111827; font-weight: 600;">${memberName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Phone Number:</td>
              <td style="padding: 6px 0; color: #111827;"><a href="tel:${memberPhone}" style="color: #32500A; text-decoration: none;">${memberPhone}</a></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Package:</td>
              <td style="padding: 6px 0; color: #111827; font-weight: 600;">${packageName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Sessions:</td>
              <td style="padding: 6px 0; color: #111827; font-weight: 600;">${sessionCount} sessions</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #6b7280; font-weight: 500;">Start Date:</td>
              <td style="padding: 6px 0; color: #111827;">${startDateStr}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 14px; color: #4b5563; line-height: 1.5; margin: 0 0 16px 0;">
          You can now coordinate their upcoming training sessions and view their updated schedule in the coach portal.
        </p>
      </div>
      <div style="background-color: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        &copy; The Mind Space. All rights reserved.
      </div>
    </div>
  `;

  // Try Resend first if key is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey && resendApiKey !== "FILL_IN") {
    try {
      console.log("Attempting dispatch via Resend...");
      const resend = new Resend(resendApiKey);
      const res = await resend.emails.send({
        from: `The Mind Space <admin@the-mind-space.com>`,
        to: targetEmail,
        subject,
        html,
      });
      console.log("Resend response:", res);
      if (!res.error) {
        console.log("Test email successfully sent via Resend!");
        return;
      }
    } catch (err: any) {
      console.warn("Resend failed:", err.message);
    }
  }

  // Fallback to Nodemailer with Gmail SMTP from dev.env
  const mailUser = process.env.MAIL_USER;
  const mailPass = process.env.MAIL_APP_PASSWORD;

  if (mailUser && mailPass) {
    console.log(`Attempting dispatch via Nodemailer (Gmail: ${mailUser})...`);
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: mailUser,
        pass: mailPass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || "The Mind Space"}" <${mailUser}>`,
      to: targetEmail,
      subject,
      html,
    });

    console.log("Test email successfully sent via Nodemailer/Gmail!", info.messageId);
    return;
  }

  console.error("No valid email transport credentials configured in dev.env");
}

main().catch(console.error);
