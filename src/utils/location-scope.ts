import { Request } from "express";
import { Types } from "mongoose";
import { BadRequestError } from "../core/ApiError";

/**
 * Branch (location) scoping helpers for admin/fd staff.
 *
 * This deployment does not assign a branch to staff users, so the target
 * branch is always taken explicitly from the request (body or query
 * `locationId`). Management-style scoping by `user.locationId` is intentionally
 * not used here.
 */

function readLocationId(req: Request): string | undefined {
  const fromBody = (req.body && (req.body as any).locationId) as
    | string
    | undefined;
  const fromQuery = req.query?.locationId as string | undefined;
  return fromBody || fromQuery;
}

/**
 * Resolves an optional location filter for list/query endpoints.
 * Returns the validated `locationId` when provided, otherwise `null`
 * (meaning: all branches).
 */
export function resolveLocationFilter(req: Request): string | null {
  const locationId = readLocationId(req);
  if (locationId && Types.ObjectId.isValid(locationId)) {
    return locationId;
  }
  return null;
}

/**
 * Resolves the branch for a write action. The caller must supply a valid
 * `locationId` (body or query); otherwise a `BRANCH_REQUIRED` error is thrown.
 */
export function resolveLocationIdForWrite(req: Request): string {
  const locationId = readLocationId(req);
  if (locationId && Types.ObjectId.isValid(locationId)) {
    return locationId;
  }
  throw new BadRequestError(
    "BRANCH_REQUIRED",
    "Select a branch (locationId) to perform this action"
  );
}
