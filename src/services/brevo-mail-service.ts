import { BrevoClient } from "@getbrevo/brevo";
import logger from "../config/logger";

export type MailAttachment = {
  name: string;
  data: string;
};

const getBrevoClient = (): BrevoClient => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || apiKey === "FILL_IN") {
    throw new Error("BREVO_API_KEY is not configured");
  }
  return new BrevoClient({ apiKey });
};

const getSenderConfig = () => {
  const email = process.env.MAIL_FROM_ADDRESS;
  const name = process.env.MAIL_FROM_NAME;

  if (!email || email === "FILL_IN") {
    throw new Error("MAIL_FROM_ADDRESS is not configured");
  }
  if (!name) {
    throw new Error("MAIL_FROM_NAME is not configured");
  }

  return {
    sender: { email, name: name.replace(/^"|"$/g, "") },
    replyTo: { email },
  };
};

const toBase64Content = (data: string): string =>
  data.includes("base64,") ? data.split("base64,")[1] : data;

const buildAttachment = (attachment?: MailAttachment) => {
  if (!attachment) return undefined;
  return [
    {
      name: attachment.name || "attachment",
      content: toBase64Content(attachment.data),
    },
  ];
};

const formatBrevoError = (error: unknown): string => {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { message?: string; code?: string } }).body;
    if (body?.message) return body.message;
  }
  if (error instanceof Error) return error.message;
  return "Failed to send email via Brevo";
};

export const sendTransactionalEmail = async (params: {
  to: string;
  subject: string;
  htmlContent: string;
  attachment?: MailAttachment;
}) => {
  const brevo = getBrevoClient();
  const { sender, replyTo } = getSenderConfig();

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender,
      replyTo,
      subject: params.subject,
      htmlContent: params.htmlContent,
      to: [{ email: params.to }],
      attachment: buildAttachment(params.attachment),
    });
  } catch (error) {
    logger.error("Brevo send error", { error, to: params.to });
    throw new Error(formatBrevoError(error));
  }
};

export const sendTransactionalEmailBatch = async (params: {
  recipients: string[];
  subject: string;
  htmlContent: string;
  attachment?: MailAttachment;
  batchSize?: number;
  delayMs?: number;
}) => {
  const { recipients, subject, htmlContent, attachment } = params;
  const BATCH_SIZE = params.batchSize ?? 50;
  const DELAY_MS = params.delayMs ?? 1000;

  const brevo = getBrevoClient();
  const { sender, replyTo } = getSenderConfig();
  const attachmentPayload = buildAttachment(attachment);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    try {
      await brevo.transactionalEmails.sendTransacEmail({
        sender,
        replyTo,
        subject,
        htmlContent,
        attachment: attachmentPayload,
        messageVersions: batch.map((email) => ({
          to: [{ email }],
        })),
      });
    } catch (error) {
      logger.error("Brevo batch send error", {
        error,
        batchStart: i,
        batchSize: batch.length,
      });
      throw new Error(formatBrevoError(error));
    }

    if (i + BATCH_SIZE < recipients.length) {
      await delay(DELAY_MS);
    }
  }
};
