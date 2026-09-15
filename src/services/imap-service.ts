import imaps from "imap-simple";
import { simpleParser } from "mailparser";
import ReceivedEmail from "../models/receivedEmail";
import User from "../models/user";
import logger from "../config/logger";

const extractRecipientEmails = (parsed: any): string[] => {
  const recipients = new Set<string>();

  const addAddress = (addr?: string) => {
    if (!addr) return;
    const clean = addr.trim().toLowerCase();
    const match = clean.match(/<([^>]+)>/) || [null, clean];
    const email = (match[1] || clean).trim();
    if (email.includes("@")) {
      recipients.add(email);
    }
  };

  if (parsed.to) {
    if (Array.isArray(parsed.to)) {
      for (const item of parsed.to) {
        if (item?.value && Array.isArray(item.value)) {
          item.value.forEach((v: any) => addAddress(v.address));
        } else if (item?.text) {
          addAddress(item.text);
        }
      }
    } else if (parsed.to.value && Array.isArray(parsed.to.value)) {
      parsed.to.value.forEach((v: any) => addAddress(v.address));
    } else if (typeof parsed.to.text === "string") {
      addAddress(parsed.to.text);
    }
  }

  const deliveredTo = parsed.headers?.get("delivered-to");
  if (typeof deliveredTo === "string") addAddress(deliveredTo);

  const origTo = parsed.headers?.get("x-original-to");
  if (typeof origTo === "string") addAddress(origTo);

  return Array.from(recipients);
};

const findRecipientUser = async (emails: string[]) => {
  if (!emails.length) return null;

  let user = await User.findOne({
    tmsEmail: { $in: emails },
    role: { $in: ["management", "managing_coach", "admin"] },
  });

  if (!user) {
    user = await User.findOne({
      email: { $in: emails },
      role: { $in: ["management", "managing_coach", "admin"] },
    });
  }

  if (!user) {
    const staff = await User.find({
      role: { $in: ["management", "managing_coach", "admin"] },
    }).select("name email tmsEmail sendAsName");

    const mailDomain = (process.env.MAIL_DOMAIN || "the-mind-space.com")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");

    for (const member of staff) {
      const derived = `${(member.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}@${mailDomain}`;
      if (emails.includes(derived)) {
        user = member as any;
        break;
      }
    }
  }

  return user;
};

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
      tlsOptions: { rejectUnauthorized: false },
    },
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
        const recipientEmails = extractRecipientEmails(parsed);
        const recipientUser = await findRecipientUser(recipientEmails);
        const primaryRecipient = recipientEmails[0] || recipientUser?.tmsEmail || "";
        let toText = primaryRecipient;
        if (parsed.to) {
          if (Array.isArray(parsed.to)) {
            toText = parsed.to.map((t: any) => t?.text || "").filter(Boolean).join(", ") || primaryRecipient;
          } else if (typeof (parsed.to as any).text === "string") {
            toText = (parsed.to as any).text;
          }
        }

        const newEmail = new ReceivedEmail({
          from: parsed.from?.text || "Unknown",
          to: toText,
          recipientEmail: primaryRecipient ? primaryRecipient.toLowerCase() : undefined,
          recipientUser: recipientUser ? recipientUser._id : undefined,
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
