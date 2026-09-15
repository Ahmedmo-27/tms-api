export interface UserMailConfig {
  email: string;
  name: string;
}

/**
 * Resolves the outbound email address and display name for a user.
 * 1. Uses user.tmsEmail if set.
 * 2. Else uses user.email if it belongs to the configured MAIL_DOMAIN.
 * 3. Else derives prefix from user.name (e.g. Ali Ahmed -> aliahmed@the-mind-space.com).
 * Display name prioritizes user.sendAsName, then user.name.
 */
export const getUserMailConfig = (user?: {
  name?: string;
  email?: string;
  tmsEmail?: string;
  sendAsName?: string;
}): UserMailConfig => {
  const envDomain = process.env.MAIL_DOMAIN;
  const mailDomain = (
    envDomain && envDomain !== "undefined" ? envDomain : "the-mind-space.com"
  )
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  if (!user) {
    const fallbackEmail = process.env.MAIL_FROM_ADDRESS || `info@${mailDomain}`;
    const fallbackName = process.env.MAIL_FROM_NAME || "The Mind Space";
    return { email: fallbackEmail, name: fallbackName.replace(/^"|"$/g, "") };
  }

  let email: string;
  if (user.tmsEmail && user.tmsEmail.trim()) {
    email = user.tmsEmail.trim().toLowerCase();
  } else if (user.email && user.email.toLowerCase().endsWith(`@${mailDomain}`)) {
    email = user.email.trim().toLowerCase();
  } else {
    const rawName = user.name || "user";
    const cleanPrefix = rawName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");
    email = `${cleanPrefix || "user"}@${mailDomain}`;
  }

  const name =
    user.sendAsName && user.sendAsName.trim()
      ? user.sendAsName.trim()
      : user.name && user.name.trim()
      ? user.name.trim()
      : "The Mind Space";

  return { email, name };
};
