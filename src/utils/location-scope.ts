import { Request } from "express";
import { Types } from "mongoose";
import { BadRequestError } from "../core/ApiError";

export type LocationIdRef =
  | Types.ObjectId
  | { _id?: Types.ObjectId }
  | string
  | null
  | undefined;

/** Normalize ObjectId, populated Location doc, or string to a location id string. */
export function normalizeLocationIdRef(
  locationId: LocationIdRef,
): string | null {
  if (!locationId) return null;
  if (typeof locationId === "string") return locationId;
  if (locationId instanceof Types.ObjectId) return locationId.toString();
  if (typeof locationId === "object" && "_id" in locationId && locationId._id) {
    return locationId._id.toString();
  }
  return null;
}

/** Convert a valid id ref to Types.ObjectId for writes. Returns null when invalid. */
export function toObjectId(locationId: LocationIdRef): Types.ObjectId | null {
  const normalized = normalizeLocationIdRef(locationId);
  if (!normalized || !Types.ObjectId.isValid(normalized)) return null;
  return new Types.ObjectId(normalized);
}

/**
 * Match a scalar ObjectId field (e.g. locationId) stored as string or ObjectId.
 * Uses $expr because Mongoose casts $in values and won't match legacy strings.
 */
export function locationIdScalarQuery(
  locationId: string,
  field = "locationId",
): Record<string, unknown> {
  return {
    $expr: { $eq: [{ $toString: `$${field}` }, locationId] },
  };
}

/**
 * Match an array of location refs (e.g. classes.locations) containing the branch id.
 * Uses $expr because Mongoose casts $in values and won't match legacy strings.
 */
export function locationIdsArrayQuery(
  locationId: string,
  field = "locations",
): Record<string, unknown> {
  return {
    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: [`$${field}`, []] },
              as: "loc",
              cond: { $eq: [{ $toString: "$$loc" }, locationId] },
            },
          },
        },
        0,
      ],
    },
  };
}

/** @deprecated Use locationIdScalarQuery or locationIdsArrayQuery */
export function objectIdFieldQuery(
  locationId: string,
): { $in: [Types.ObjectId, string] } {
  return { $in: [new Types.ObjectId(locationId), locationId] };
}

/** Match daily attendance rows to a branch filter (legacy rows without location pass through). */
export function attendanceEntryMatchesLocation(
  entry: { locationId?: LocationIdRef },
  targetLocationId: string,
): boolean {
  const entryLocationId = normalizeLocationIdRef(entry.locationId);
  return !entryLocationId || entryLocationId === targetLocationId;
}

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
