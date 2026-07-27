import { Types } from "mongoose";
import Location from "../models/location";
import { BadRequestError } from "../core/ApiError";
import { getMatchaLocationId } from "./matcha-branch";

const DEFAULT_MAIN_BRANCH_NAME = "The Mind Space";

let cachedMainLocationId: string | null | undefined;

export function clearMainLocationCache(): void {
  cachedMainLocationId = undefined;
}

/**
 * Cairo / main Mind Space branch. Used when an APP package purchase has no
 * package-level locationId (e.g. studio packs).
 */
export async function getMainBranchLocationId(): Promise<string | null> {
  const envId =
    process.env.MAIN_LOCATION_ID?.trim() ||
    process.env.CAIRO_LOCATION_ID?.trim();
  if (envId) {
    if (!Types.ObjectId.isValid(envId)) {
      throw new BadRequestError(
        "INVALID_MAIN_LOCATION_ID",
        "MAIN_LOCATION_ID must be a valid MongoDB ObjectId",
      );
    }
    return envId;
  }

  if (cachedMainLocationId !== undefined) {
    return cachedMainLocationId;
  }

  const branchName =
    process.env.MAIN_BRANCH_NAME?.trim() || DEFAULT_MAIN_BRANCH_NAME;
  const escaped = branchName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byBranch = await Location.findOne({
    branchName: { $regex: new RegExp(`^${escaped}$`, "i") },
  });
  if (byBranch) {
    cachedMainLocationId = (byBranch._id as Types.ObjectId).toString();
    return cachedMainLocationId;
  }

  const byCairo = await Location.findOne({ location: /cairo/i });
  cachedMainLocationId = byCairo
    ? (byCairo._id as Types.ObjectId).toString()
    : null;
  return cachedMainLocationId;
}

/**
 * Branch for APP (Geidea) package confirm / payment save.
 * Order: pending → Matcha; else package.locationId; else main (Cairo) branch.
 */
export async function resolveAppPackageLocationId(
  pkg: { locationId?: Types.ObjectId | { _id?: Types.ObjectId } | null },
  pendingMember: boolean,
): Promise<string> {
  if (pendingMember) {
    const matchaId = await getMatchaLocationId();
    if (!matchaId) {
      throw new BadRequestError(
        "MATCHA_BRANCH_NOT_CONFIGURED",
        "Matcha branch is not configured",
      );
    }
    return matchaId;
  }

  const raw = pkg.locationId;
  if (raw) {
    if (typeof raw === "object" && "_id" in raw && raw._id) {
      return raw._id.toString();
    }
    return raw.toString();
  }

  const mainId = await getMainBranchLocationId();
  if (!mainId) {
    throw new BadRequestError(
      "BRANCH_REQUIRED",
      "Unable to resolve a branch for this package payment",
    );
  }
  return mainId;
}
