import { InternalError } from "../core/ApiError";
import logger from "../config/logger";
import { Resend } from "resend";

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
