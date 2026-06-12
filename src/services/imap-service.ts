import imaps from "imap-simple";
import { simpleParser } from "mailparser";
import ReceivedEmail from "../models/receivedEmail";
import logger from "../config/logger";

export const syncEmails = async () => {
  if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) {
    logger.warn("Skipping IMAP sync: MAIL_USER or MAIL_APP_PASSWORD not set");
    return;
  }

  const config = {
    imap: {
      user: process.env.MAIL_USER,
      password: process.env.MAIL_APP_PASSWORD,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };

  try {
    const connection = await imaps.connect(config);
    await connection.openBox("INBOX");

    // Fetch emails from the last 30 days
    const delay = 30 * 24 * 3600 * 1000;
    const pastDate = new Date();
    pastDate.setTime(Date.now() - delay);
    const searchCriteria = [["SINCE", pastDate.toISOString()]];
    const fetchOptions = {
      bodies: [""], // Fetch full body
      struct: true,
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const item of messages) {
      const all = item.parts.find((part) => part.which === "");
      if (!all || !all.body) continue;
      
      const parsed = await simpleParser(all.body);
      const messageId = parsed.messageId || `${item.attributes.uid}`;

      // Check if email already exists
      const existing = await ReceivedEmail.findOne({ messageId });
      if (!existing) {
        const newEmail = new ReceivedEmail({
          from: parsed.from?.text || "Unknown",
          subject: parsed.subject || "No Subject",
          text: parsed.text || "",
          html: parsed.html || parsed.textAsHtml || "",
          date: parsed.date || new Date(),
          messageId,
          isRead: false,
        });
        await newEmail.save();
      }
    }

    connection.end();
    logger.info(`IMAP Email sync completed. Processed ${messages.length} recent messages.`);
  } catch (error) {
    logger.error("Failed to sync IMAP emails:", error);
  }
};
