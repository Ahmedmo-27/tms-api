import { Request, Response } from "express";
import Package from "../../models/package";
import Member from "../../models/member";
import Class from "../../models/class";
import Coach from "../../models/coach";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { logoutUser } from "../auth/auth-controller";
import NonUserPackage from "../../models/nonUserPackage";
import { runInTransaction } from "../../utils/transaction";
import { ClientSession } from "mongoose";
import { resolveLocationFilter, resolveLocationIdForWrite, locationIdScalarQuery, toObjectId } from "../../utils/location-scope";
import { normalizePhoneNumber } from "../../utils/phone";
import { normalizeOpenGymPackageFields } from "../../utils/open-gym-package";
import { Types } from "mongoose";
import { getPackageDeletionImpact, cleanUpDeprecatedPackages } from "../../services/package-deletion-guard";
import logger from "../../config/logger";
import {
  isSameCairoDay,
  startOfTodayCairo,
  toStoredPackageDate,
} from "../../utils/timezone";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validatePackagePayload(
  payload: {
    name?: unknown;
    category?: unknown;
    price?: unknown;
    numberOfSessions?: unknown;
    expiryPeriod?: unknown;
    coachId?: unknown;
    opensClasses?: unknown;
    classRestrictions?: unknown;
  },
  isUpdate = false,
) {
  if (!isUpdate || payload.name !== undefined) {
    const trimmed = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!trimmed) {
      throw new BadRequestError("PACKAGE_NAME_REQUIRED", "Package name is required");
    }
    if (trimmed.length < 2) {
      throw new BadRequestError("INVALID_PACKAGE_NAME", "Package name must be at least 2 characters");
    }
  }

  if (!isUpdate || payload.category !== undefined) {
    if (!payload.category || typeof payload.category !== "string" || !payload.category.trim()) {
      throw new BadRequestError("PACKAGE_CATEGORY_REQUIRED", "Package category is required");
    }
  }

  if (!isUpdate || payload.price !== undefined) {
    if (payload.price === undefined || payload.price === null || payload.price === "" || Number.isNaN(Number(payload.price))) {
      throw new BadRequestError("PRICE_REQUIRED", "Package price is required and must be a number");
    }
    const numPrice = Number(payload.price);
    if (numPrice < 0) {
      throw new BadRequestError("INVALID_PRICE", "Package price cannot be negative");
    }
  }

  if (payload.category !== "OPEN_GYM" && (!isUpdate || payload.numberOfSessions !== undefined)) {
    if (payload.numberOfSessions === undefined || payload.numberOfSessions === null || payload.numberOfSessions === "" || Number.isNaN(Number(payload.numberOfSessions))) {
      throw new BadRequestError("SESSIONS_REQUIRED", "Number of sessions is required");
    }
    const numSessions = Number(payload.numberOfSessions);
    if (!Number.isInteger(numSessions) || numSessions < 1) {
      throw new BadRequestError("INVALID_SESSIONS", "Number of sessions must be at least 1");
    }
  }

  if (!isUpdate || payload.expiryPeriod !== undefined) {
    if (payload.expiryPeriod === undefined || payload.expiryPeriod === null || payload.expiryPeriod === "" || Number.isNaN(Number(payload.expiryPeriod))) {
      throw new BadRequestError("EXPIRY_PERIOD_REQUIRED", "Expiry period is required");
    }
    const numExpiry = Number(payload.expiryPeriod);
    if (!Number.isInteger(numExpiry) || numExpiry < 1) {
      throw new BadRequestError("INVALID_EXPIRY_PERIOD", "Expiry period must be at least 1 day");
    }
  }
}

async function validatePackageRelations(payload: {
  category?: string;
  coachId?: string;
  opensClasses?: string[];
  classRestrictions?: Array<{ cid: string; limit: number }>;
}) {
  if (payload.category === "PERSONAL_TRAINING") {
    if (!payload.coachId) {
      throw new BadRequestError("COACH_REQUIRED", "A coach must be assigned to personal training packages");
    }
    if (!Types.ObjectId.isValid(payload.coachId)) {
      throw new BadRequestError("INVALID_COACH", "Invalid coach ID");
    }
    const coach = await Coach.findById(payload.coachId);
    if (!coach) {
      throw new NotFoundError("COACH_NOT_FOUND", "Selected coach does not exist");
    }
  }

  if (payload.opensClasses && Array.isArray(payload.opensClasses) && payload.opensClasses.length > 0) {
    for (const cid of payload.opensClasses) {
      if (!cid || !Types.ObjectId.isValid(cid)) {
        throw new BadRequestError("INVALID_CLASS_SELECTION", `Invalid class ID: ${cid}`);
      }
    }
    const count = await Class.countDocuments({ _id: { $in: payload.opensClasses } });
    if (count !== payload.opensClasses.length) {
      throw new NotFoundError("CLASS_NOT_FOUND", "One or more selected classes do not exist");
    }
  }

  if (payload.classRestrictions && Array.isArray(payload.classRestrictions) && payload.classRestrictions.length > 0) {
    for (const res of payload.classRestrictions) {
      if (!res.cid || !Types.ObjectId.isValid(res.cid)) {
        throw new BadRequestError("INVALID_CLASS_RESTRICTION", "Class restriction must reference a valid class ID");
      }
      if (res.limit === undefined || res.limit === null || Number.isNaN(Number(res.limit)) || Number(res.limit) < 1) {
        throw new BadRequestError("INVALID_CLASS_RESTRICTION", "Class restriction limit must be at least 1 session");
      }
    }
  }
}

async function assertNoDuplicatePackage(
  name: string,
  category: string,
  locationId?: string | null,
  excludeId?: string,
) {
  const query: any = {
    name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, "i") },
    category,
  };
  if (excludeId) {
    query._id = { $ne: new Types.ObjectId(excludeId) };
  }
  if (category === "OPEN_GYM" && locationId) {
    query.locationId = new Types.ObjectId(locationId);
  }
  const existing = await Package.findOne(query);
  if (existing) {
    throw new ConflictError(
      "PACKAGE_ALREADY_EXISTS",
      `A package named "${name.trim()}" already exists in category "${category}"`,
    );
  }
}

export const getPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  await cleanUpDeprecatedPackages();
  const { name, category, coachId } = req.query;
  const query: any = {};
  if (name) {
    query.name = { $regex: String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  if (category) {
    query.category = category;
  }
  if (coachId) {
    query.coachId = coachId;
  }
  const targetLocationId = resolveLocationFilter(req);
  if (targetLocationId) {
    query.$or = [
      { locationId: { $exists: false } },
      { locationId: null },
      locationIdScalarQuery(targetLocationId),
    ];
  }
  let packages = await Package.find(query)
    .populate({ path: "coachId" })
    .populate({ path: "locationId", select: "_id branchName location" })
    .populate({ path: "opensClasses", select: "_id title" });
  if (!packages || packages.length === 0)
    throw new NotFoundError("PACKAGES_NOT_FOUND", "Packages not found");
  new SuccessResponse("Packages Found!", packages).send(res);
});

export const addPackage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      name,
      category,
      price,
      opensClasses,
      coachId,
      classRestrictions,
      expiryPeriod,
      numberOfSessions,
    } = req.body;

    validatePackagePayload({
      name,
      category,
      price,
      numberOfSessions,
      expiryPeriod,
      coachId,
      opensClasses,
      classRestrictions,
    });

    const targetLocationId =
      category === "OPEN_GYM" ? resolveLocationIdForWrite(req) : null;

    await validatePackageRelations({
      category,
      coachId,
      opensClasses,
      classRestrictions,
    });

    await assertNoDuplicatePackage(name, category, targetLocationId);

    const normalized = normalizeOpenGymPackageFields({
      category,
      expiryPeriod,
      numberOfSessions,
      opensClasses,
    });

    const pkg = new Package({
      name: name.trim(),
      numberOfSessions: normalized.numberOfSessions,
      category,
      price: Number(price),
      expiryPeriod: normalized.expiryPeriod,
      coachId,
      opensClasses,
      classRestrictions,
      ...(targetLocationId
        ? { locationId: new Types.ObjectId(targetLocationId) }
        : {}),
    });
    await pkg.save();
    new SuccessResponse("Package Added!", pkg).send(res);
  }
);

export const getPackageDeletionImpactReport = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const impact = await getPackageDeletionImpact(id);
    new SuccessResponse("Package deletion impact", impact).send(res);
  },
);

export const deletePackage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const impact = await getPackageDeletionImpact(id);

    const pkg = await Package.findById(id);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", { id });

    if (impact.activeSubscriptions > 0) {
      pkg.isDeprecated = true;
      pkg.hidden = true;
      await pkg.save();
      new SuccessResponse("Package Deprecated!", {
        deletedPackage: pkg,
        message: "Package has been deprecated (soft-deleted) because it has active subscribers.",
      }).send(res);
    } else {
      await Package.findByIdAndDelete(id);
      new SuccessResponse("Package Deleted!", {
        deletedPackage: pkg,
        message: "Package has been completely deleted.",
      }).send(res);
    }
  },
);

export const updatePackage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const allowedUpdates = [
      "name",
      "category",
      "numberOfSessions",
      "price",
      "expiryPeriod",
      "renewalPeriod",
      "opensClasses",
      "hidden",
      "classRestrictions",
      "locationId",
      "coachId",
    ];
    const updates = Object.keys(req.body);
    const isValidUpdate = updates.every((update) =>
      allowedUpdates.includes(update)
    );
    if (!isValidUpdate)
      throw new BadRequestError("INVALID_UPDATES", "Invalid updates");

    const existing = await Package.findById(id);
    if (!existing)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", { id });

    validatePackagePayload(req.body, true);

    if (req.body.name || req.body.category) {
      await assertNoDuplicatePackage(
        req.body.name ?? existing.name,
        req.body.category ?? existing.category,
        req.body.locationId ?? existing.locationId?.toString(),
        id,
      );
    }

    if (req.body.coachId || req.body.opensClasses || req.body.classRestrictions) {
      await validatePackageRelations({
        category: req.body.category ?? existing.category,
        coachId: req.body.coachId ?? existing.coachId?.toString(),
        opensClasses: req.body.opensClasses ?? existing.opensClasses?.map((c: any) => String(c)),
        classRestrictions: req.body.classRestrictions ?? existing.classRestrictions,
      });
    }

    const merged = {
      category: req.body.category ?? existing.category,
      expiryPeriod: req.body.expiryPeriod ?? existing.expiryPeriod,
      numberOfSessions: req.body.numberOfSessions ?? existing.numberOfSessions,
      opensClasses: req.body.opensClasses ?? existing.opensClasses,
    };
    const normalized = normalizeOpenGymPackageFields(merged);
    const updatePayload: Record<string, unknown> = {
      ...req.body,
      expiryPeriod: normalized.expiryPeriod,
      numberOfSessions: normalized.numberOfSessions,
    };
    if (updatePayload.locationId !== undefined && updatePayload.locationId !== null) {
      const locationObjectId = toObjectId(updatePayload.locationId as string);
      if (!locationObjectId) {
        throw new BadRequestError("INVALID_LOCATION", "Invalid locationId");
      }
      updatePayload.locationId = locationObjectId;
    }

    const pkg = await Package.findByIdAndUpdate(id, updatePayload, { new: true });
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", { id });
    new SuccessResponse("Package Updated!", pkg).send(res);
  }
);

export const subMemberToPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const {
    uid,
    pkgId,
    pkgStartDate,
    paymentMethod,
    paymentDate,
    amount,
    note,
    pendingDeduction,
  } = req.body;
  const targetLocationId = resolveLocationIdForWrite(req);
  const io = req.app.get("io");
  await SubscriptionsService.frontDeskSubscribeToPackage(
    uid,
    pkgId,
    pkgStartDate,
    paymentMethod,
    paymentDate,
    amount,
    note,
    io,
    targetLocationId,
    pendingDeduction === true || pendingDeduction === "true",
  );
  new SuccessResponse("Package Added!").send(res);
});

export const unsubMemberFromPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, pkgId, pkgStartDate } = req.body;
  if (!uid || !pkgId || !pkgStartDate)
    throw new BadRequestError("INVALID_REQUEST_BODY", "Missing data!");
  await SubscriptionsService.unsubscribeFromPackage(uid, pkgId, pkgStartDate);
  new SuccessResponse("Package Deleted!").send(res);
});

export const editMemberPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, pkgId, pkgStartDate, pkgEndDate } = req.body;
  const member = await Member.findOne({ uid });
  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });
  const pkg = member.packages.find(
    (p) =>
      p.pkgId.toString() === pkgId &&
      isSameCairoDay(p.pkgStartDate, pkgStartDate)
  );
  if (!pkg)
    throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
      pkgId,
    });

  if (pkgEndDate) {
    pkg.pkgEndDate = toStoredPackageDate(pkgEndDate);

    if (toStoredPackageDate(pkgEndDate) < startOfTodayCairo()) {
      pkg.status = "EXPIRED";
    } else {
      pkg.status = "ACTIVE";
    }
    // Member.editExpiryDate(uid, pkgId, pkgStartDate, pkgEndDate);
  }
  await member.save();
  new SuccessResponse("Package Updated!", pkg).send(res);
});

export const adjustMemberPackageClasses = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, pkgId, pkgStartDate, amount, type, reason } = req.body;
  if (!reason || !reason.toString().trim())
    throw new BadRequestError("MISSING_REASON", "A reason is required");
  if (!amount || Number(amount) < 1)
    throw new BadRequestError("INVALID_AMOUNT", "Amount must be at least 1");
  if (!type || !["ADD", "DEDUCT"].includes(type))
    throw new BadRequestError("INVALID_TYPE", "Type must be ADD or DEDUCT");

  const member = await Member.findOne({ uid });
  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { uid });

  const pkg = member.packages.find(
    (p) =>
      p.pkgId.toString() === pkgId &&
      isSameCairoDay(p.pkgStartDate, pkgStartDate)
  );
  if (!pkg)
    throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", { pkgId });

  if (type === "DEDUCT" && Number(amount) > pkg.remainingClasses)
    throw new BadRequestError(
      "INSUFFICIENT_CLASSES",
      "Cannot deduct more classes than remaining"
    );

  const newClasses =
    type === "ADD"
      ? pkg.remainingClasses + Number(amount)
      : pkg.remainingClasses - Number(amount);

  await runInTransaction(async (session: ClientSession) => {
    await Member.editPackageClasses(uid, pkgId, pkgStartDate, newClasses);
    await Member.pushAdjustmentRecord(
      uid,
      pkgId,
      pkg.pkgStartDate,
      {
        date: new Date(),
        source: "ADMIN",
        type,
        amount: Number(amount),
        reason: reason.toString().trim(),
      },
      session
    );
  });

  new SuccessResponse("Package updated!", pkg).send(res);
});

export const addNonUserPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const {
    name,
    phoneNumber,
    pendingDeduction,
    pkgId,
    pkgStartDate,
    paymentMethod,
    paymentDate,
    amount,
    locationId,
  } = req.body;

  const targetLocationId = resolveLocationIdForWrite(req);

  const trimmedName = (name as string)?.trim();
  const cleanPhone = normalizePhoneNumber(phoneNumber as string);
  if (!trimmedName) {
    throw new BadRequestError("INVALID_NAME", "Name is required");
  }
  if (!/^[0-9]{11}$/.test(cleanPhone)) {
    throw new BadRequestError("INVALID_PHONE", "Phone number must be 11 digits");
  }

  await SubscriptionsService.addNonUserPackage(
    trimmedName,
    cleanPhone,
    pkgId,
    pkgStartDate,
    paymentMethod,
    pendingDeduction,
    paymentDate,
    amount,
    targetLocationId
  );
  new SuccessResponse("Package Added!").send(res);
});

export const getNonUserPackages = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { name, phoneNumber, date, search } = req.query;
  const searchTerm = (search || name || phoneNumber) ? String(search || name || phoneNumber).trim() : "";
  const query: any = {};
  if (searchTerm) {
    const escaped = escapeRegex(searchTerm);
    const cleanPhone = searchTerm.replace(/[\s\-+]/g, "");
    const orConditions: any[] = [
      { name: { $regex: escaped, $options: "i" } },
      { phoneNumber: { $regex: escaped, $options: "i" } },
    ];
    if (cleanPhone && cleanPhone !== searchTerm) {
      orConditions.push({ phoneNumber: { $regex: escapeRegex(cleanPhone), $options: "i" } });
    }
    query.$or = orConditions;
  }
  if (date) {
    query.createdAt = { $gte: new Date(date as string) };
  }
  query.added = { $ne: true };
  let packages = await NonUserPackage.find(query).populate({ path: "pkgId" });
  if (!packages || packages.length === 0)
    throw new NotFoundError("PACKAGES_NOT_FOUND", "Packages not found");
  new SuccessResponse("Packages Found!", packages).send(res);
});
