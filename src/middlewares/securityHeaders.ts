import { Request, Response, NextFunction } from "express";

/**
 * Lightweight security headers (Helmet-equivalent subset) so we do not hard-depend
 * on the helmet package being present at runtime.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.removeHeader("X-Powered-By");
  next();
}
