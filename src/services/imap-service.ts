import imaps from "imap-simple";
import { simpleParser } from "mailparser";
import ReceivedEmail from "../models/receivedEmail";
import User from "../models/user";
import logger from "../config/logger";
import { getIO } from "../config/socket";
import { NotificationsService } from "./notifications-service";

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

  const fwdTo = parsed.headers?.get("x-forwarded-to");
  if (typeof fwdTo === "string") addAddress(fwdTo);

  const envTo = parsed.headers?.get("x-envelope-to");
  if (typeof envTo === "string") addAddress(envTo);

  const deliveredTo = parsed.headers?.get("delivered-to");
  if (typeof deliveredTo === "string") addAddress(deliveredTo);

  const origTo = parsed.headers?.get("x-original-to");
  if (typeof origTo === "string") addAddress(origTo);

  return Array.from(recipients);
};

const findRecipientUsers = async (emails: string[]) => {
  if (!emails.length) return [];

  const escapedRegexes = emails.map(
    (e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
  );

  const matchedUsers = await User.find({
    $or: [
      { tmsEmail: { $in: escapedRegexes } },
      { email: { $in: escapedRegexes } },
    ],
    role: { $in: ["management", "managing_coach", "admin", "mailer"] },
  });

  if (matchedUsers.length === 0) {
    const staff = await User.find({
      role: { $in: ["management", "managing_coach", "admin", "mailer"] },
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
        matchedUsers.push(member as any);
      }
    }
  }

  return matchedUsers;
};

const findRecipientUser = async (emails: string[]) => {
  const users = await findRecipientUsers(emails);
  return users[0] || null;
};

const findSpamBoxName = (boxes: any, prefix = ""): string | null => {
  if (!boxes || typeof boxes !== "object") return null;
  for (const [name, box] of Object.entries<any>(boxes)) {
    const fullName = prefix ? `${prefix}${box.delimiter || "/"}${name}` : name;
    const attribs = (box.attribs || []).map((a: string) => String(a).toLowerCase());
    if (attribs.includes("\\spam") || attribs.includes("\\junk")) {
      return fullName;
    }
    if (/^(spam|junk)$/i.test(name)) {
      return fullName;
    }
    if (box.children) {
      const childMatch = findSpamBoxName(box.children, fullName);
      if (childMatch) return childMatch;
    }
  }
  return null;
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

    // Discover mailboxes (INBOX + Spam/Junk fallback)
    let spamBoxName: string | null = null;
    try {
      const boxes = await connection.getBoxes();
      spamBoxName = findSpamBoxName(boxes);
    } catch (boxErr) {
      logger.debug("Failed to list mailboxes from IMAP, using standard fallback", boxErr);
    }

    const mailboxesToScan: string[] = ["INBOX"];
    const fallbackSpam = spamBoxName || "[Gmail]/Spam";
    if (!mailboxesToScan.includes(fallbackSpam)) {
      mailboxesToScan.push(fallbackSpam);
    }

    let totalProcessed = 0;

    for (const boxName of mailboxesToScan) {
      try {
        await connection.openBox(boxName);

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
        totalProcessed += messages.length;

        for (const item of messages) {
          const all = item.parts.find((part) => part.which === "");
          if (!all || !all.body) continue;

          const parsed = await simpleParser(all.body);
          const messageId = parsed.messageId || `${boxName}-${item.attributes.uid}`;

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

            // Send notifications for newly received email
            try {
              const fromSender = parsed.from?.text || "Unknown Sender";
              const emailSubject = parsed.subject || "No Subject";
              const snippet = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 150);

              // 1. Determine target users for push notification
              const targetUsers = await findRecipientUsers(recipientEmails);
              const targetUserIds = targetUsers.map((u) => String(u._id));

              if (targetUserIds.length > 0) {
                NotificationsService.notifyUsers(
                  targetUserIds,
                  `New Email: ${emailSubject}`,
                  `From: ${fromSender}`,
                  {
                    type: "NEW_EMAIL",
                    emailId: String(newEmail._id),
                    from: fromSender,
                    subject: emailSubject,
                  }
                ).catch((notifErr) =>
                  logger.warn("Failed to send push notification for new email", notifErr)
                );
              }

              // 2. Real-time Socket.IO notification (targeted directly to recipient users)
              const io = getIO();
              if (io && targetUserIds.length > 0) {
                const socketPayload = {
                  id: String(newEmail._id),
                  _id: String(newEmail._id),
                  from: newEmail.from,
                  to: newEmail.to,
                  subject: newEmail.subject,
                  snippet,
                  date: newEmail.date.toISOString(),
                  recipientEmail: newEmail.recipientEmail,
                  recipientUser: recipientUser ? String(recipientUser._id) : null,
                };

                for (const uid of targetUserIds) {
                  io.to(`user:${uid}`).emit("mail:newEmail", socketPayload);
                }
              }
            } catch (notifyError) {
              logger.warn("Error notifying users of new email:", notifyError);
            }
          }
        }
      } catch (boxError: any) {
        logger.warn(`Could not sync mailbox "${boxName}": ${boxError?.message || boxError}`);
      }
    }

    connection.end();
    logger.info(`IMAP Email sync completed. Processed ${totalProcessed} recent messages across scanned mailboxes.`);
  } catch (error) {
    logger.error("Failed to sync IMAP emails:", error);
  }
};
