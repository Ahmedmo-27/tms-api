import { Request } from "express";
import { Types } from "mongoose";
import { BadRequestError } from "../core/ApiError";

export function normalizeRole(role: string | undefined): string {
  if (!role) return "";
  return role === "admin" ? "management" : role;
}

export function isBranchScopedRole(role: string | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "branch_admin";
}

export function isManagementRole(role: string | undefined): boolean {
  return normalizeRole(role) === "management";
}

/**
 * Resolves location filter for list/query endpoints.
 * branch_admin: always forced to their user.locationId (client cannot override).
 * management: optional ?locationId= or body.locationId; null = all branches.
 */
export function resolveLocationFilter(req: Request): string | null {
  const user = (req as any).user;
  const role = normalizeRole(user?.role);
  const userLocationId = user?.locationId?.toString() ?? null;

  if (isBranchScopedRole(role)) {
    return userLocationId;
  }

  if (role === "management") {
    const queryLocationId =
      (req.query.locationId as string) || (req.body?.locationId as string);
    if (queryLocationId && Types.ObjectId.isValid(queryLocationId)) {
      return queryLocationId;
    }
  }

  return null;
}

/** branch_admin only — their assigned branch, or null for management. */
export function getAssignedBranchLocationId(req: Request): string | null {
  if (!isBranchScopedRole((req as any).user?.role)) return null;
  return (req as any).user?.locationId?.toString() ?? null;
}

/**
 * branch_admin: uses their assigned locationId.
 * management: must pass locationId (body or query) — same branch-scoped abilities as branch_admin.
 */
export function resolveLocationIdForWrite(req: Request): string {
  const assigned = getAssignedBranchLocationId(req);
  if (assigned) return assigned;

  if (isManagementRole((req as any).user?.role)) {
    const locationId =
      (req.body?.locationId as string) || (req.query.locationId as string);
    if (locationId && Types.ObjectId.isValid(locationId)) {
      return locationId;
    }
    throw new BadRequestError(
      "BRANCH_REQUIRED",
      "Select a branch (locationId) to perform this action"
    );
  }

  throw new BadRequestError(
    "BRANCH_REQUIRED",
    "A branch locationId is required for this action"
  );
}
