import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

/**
 * Pacing middleware to resolve mobile client-side race condition in knowpackages.dart.
 * When a mobile member opens the packages screen, the app requests /profile and /packages concurrently.
 * A 1,200ms pacing window guarantees /profile finishes and sets _isUserMember = true in Flutter state
 * before /packages arrives, even on cold starts with deep booking history.
 */
export const MOBILE_MEMBER_PACING_DELAY_MS = 1200;

export function mobileMemberPackagePacing(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authReq = req as AuthRequest;
  const isMobile =
    authReq.deviceType === "mobile" ||
    req.headers["x-device-type"] === "mobile" ||
    req.headers["xdevice-type"] === "mobile";

  const isMember = authReq.user && authReq.user.role === "member";
  const hasNoFilter = !req.query.category && !req.query.coachId && !req.query.name;

  if (isMobile && isMember && hasNoFilter) {
    setTimeout(next, MOBILE_MEMBER_PACING_DELAY_MS);
    return;
  }

  next();
}
