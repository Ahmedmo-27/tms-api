import { CookieOptions } from "express";

/** Prefer secure cookies whenever we are not in an explicit local/test env. */
export function useSecureCookies(): boolean {
  const env = (process.env.NODE_ENV || "").toLowerCase();
  if (env === "production" || env === "prod" || env === "staging") return true;
  if (process.env.FORCE_SECURE_COOKIES === "true") return true;
  return false;
}

export function authCookieOptions(): CookieOptions {
  const secure = useSecureCookies();
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}
