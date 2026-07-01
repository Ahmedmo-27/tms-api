import { ClientSession, Types } from "mongoose";
import Location from "../models/location";
import Member, { IMember } from "../models/member";
import User from "../models/user";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../core/ApiError";

const DEFAULT_MATCHA_BRANCH_NAME = "Matcha";

let cachedMatchaLocationId: string | null | undefined;

export function getMatchaBranchName(): string {
  return process.env.MATCHA_BRANCH_NAME?.trim() || DEFAULT_MATCHA_BRANCH_NAME;
}

export function clearMatchaLocationCache(): void {
  cachedMatchaLocationId = undefined;
}

export async function getMatchaLocationId(): Promise<string | null> {
  const envId = process.env.MATCHA_LOCATION_ID?.trim();
  if (envId) {
    if (!Types.ObjectId.isValid(envId)) {
      throw new BadRequestError(
        "INVALID_MATCHA_LOCATION_ID",
        "MATCHA_LOCATION_ID must be a valid MongoDB ObjectId",
      );
    }
    return envId;
  }

  if (cachedMatchaLocationId !== undefined) {
    return cachedMatchaLocationId;
  }

  const branchName = getMatchaBranchName();
  const escaped = branchName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const location = await Location.findOne({
    branchName: { $regex: new RegExp(`^${escaped}$`, "i") },
  });

  cachedMatchaLocationId = location
    ? (location._id as Types.ObjectId).toString()
    : null;
  return cachedMatchaLocationId;
}

export async function isMatchaLocationId(
  locationId: string | Types.ObjectId | null | undefined,
): Promise<boolean> {
  if (!locationId) return false;
  const matchaId = await getMatchaLocationId();
  if (!matchaId) return false;
  return locationId.toString() === matchaId;
}

export async function isPendingMember(uid: string): Promise<boolean> {
  const user = await User.findById(uid).select("role");
  return user?.role === "user";
}

export async function ensureMemberForPendingPurchase(
  uid: string,
  session?: ClientSession,
): Promise<IMember> {
  const user = await User.findById(uid).session(session ?? null);
  if (!user || user.role !== "user") {
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
  }

  const uidObjectId = new Types.ObjectId(uid);
  const upsertOptions = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
    ...(session ? { session } : {}),
  };

  try {
    const member = await Member.findOneAndUpdate(
      { uid: uidObjectId },
      {
        $setOnInsert: {
          uid: uidObjectId,
          packages: [],
          bookings: [],
          attendance: [],
          isActive: true,
        },
      },
      upsertOptions,
    );
    if (!member) {
      throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
    }
    return member;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      const existing = await Member.findOne({ uid: uidObjectId }).session(
        session ?? null,
      );
      if (existing) return existing;
    }
    throw error;
  }
}

export async function assertMatchaPackageForPendingUser(pkg: {
  locationId?: Types.ObjectId | null;
}): Promise<void> {
  const matchaId = await getMatchaLocationId();
  if (!matchaId) {
    throw new BadRequestError(
      "MATCHA_BRANCH_NOT_CONFIGURED",
      "Matcha branch is not configured",
    );
  }
  if (!pkg.locationId || pkg.locationId.toString() !== matchaId) {
    throw new ForbiddenError(
      "PENDING_PURCHASE_BRANCH_RESTRICTED",
      "Pending members can only purchase packages at the Matcha branch",
    );
  }
}

export async function assertMatchaSessionForPendingUser(scheduledClass: {
  locationId?: Types.ObjectId | null;
}): Promise<void> {
  const matchaId = await getMatchaLocationId();
  if (!matchaId) {
    throw new BadRequestError(
      "MATCHA_BRANCH_NOT_CONFIGURED",
      "Matcha branch is not configured",
    );
  }
  if (
    !scheduledClass.locationId ||
    scheduledClass.locationId.toString() !== matchaId
  ) {
    throw new ForbiddenError(
      "PENDING_PURCHASE_BRANCH_RESTRICTED",
      "Pending members can only book sessions at the Matcha branch",
    );
  }
}

export async function buildMatchaPackageFilter(): Promise<Record<string, unknown>> {
  const matchaId = await getMatchaLocationId();
  if (!matchaId) {
    throw new BadRequestError(
      "MATCHA_BRANCH_NOT_CONFIGURED",
      "Matcha branch is not configured",
    );
  }
  return {
    hidden: { $ne: true },
    locationId: new Types.ObjectId(matchaId),
  };
}
