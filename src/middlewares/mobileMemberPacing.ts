import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

/**
 * Pacing middleware to resolve mobile client-side race condition in knowpackages.dart.
 * When a mobile member opens the packages screen, the app requests /profile and /packages concurrently.
 * A 500ms pacing window allows /profile to finish and set _isUserMember = true in Flutter state
 * before /packages arrives, preventing the client from filtering to online packages only.
 */
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
    setTimeout(next, 500);
    return;
  }

  next();
}
