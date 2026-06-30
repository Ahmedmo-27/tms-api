import { Request, Response } from "express";
import Package, {
  OPEN_GYM_RENEWAL_DAYS,
  OpenGymRenewalPeriod,
} from "../../models/package";
import Member from "../../models/member";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { logoutUser } from "../auth/auth-controller";
import NonUserPackage from "../../models/nonUserPackage";
import { runInTransaction } from "../../utils/transaction";
import { ClientSession } from "mongoose";
import { resolveLocationFilter } from "../../utils/location-scope";
import { normalizePhoneNumber } from "../../utils/phone";
import { Types } from "mongoose";

export const getPackage = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { name, category, coachId } = req.query;
  const query: any = {};
  if (name) {
    query.name = { $regex: name, $options: "i" };
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
      { locationId: new Types.ObjectId(targetLocationId) },
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

function normalizeOpenGymPackageFields(body: {
  category: string;
  expiryPeriod?: number;
  renewalPeriod?: OpenGymRenewalPeriod;
  numberOfSessions?: number;
}): { expiryPeriod: number; renewalPeriod?: OpenGymRenewalPeriod; numberOfSessions: number } {
  if (body.category !== "OPEN_GYM") {
    if (!body.expiryPeriod)
      throw new BadRequestError("INVALID_REQUEST", "Invalid request");
    return {
      expiryPeriod: body.expiryPeriod,
      numberOfSessions: body.numberOfSessions ?? 1000,
    };
  }

  const renewalPeriod = body.renewalPeriod;
  let expiryPeriod = body.expiryPeriod;

  if (renewalPeriod) {
    expiryPeriod = OPEN_GYM_RENEWAL_DAYS[renewalPeriod];
  } else if (!expiryPeriod || ![7, 30].includes(expiryPeriod)) {
    throw new BadRequestError(
      "INVALID_OPEN_GYM_RENEWAL",
      "Open gym packages require renewalPeriod (WEEKLY or MONTHLY) or expiryPeriod of 7 or 30 days",
    );
  } else {
    expiryPeriod =
      expiryPeriod === 7
        ? OPEN_GYM_RENEWAL_DAYS.WEEKLY
        : OPEN_GYM_RENEWAL_DAYS.MONTHLY;
  }

  const resolvedRenewal: OpenGymRenewalPeriod | undefined =
    renewalPeriod ??
    (expiryPeriod === OPEN_GYM_RENEWAL_DAYS.WEEKLY ? "WEEKLY" : "MONTHLY");

  return {
    expiryPeriod,
    renewalPeriod: resolvedRenewal,
    numberOfSessions: body.numberOfSessions ?? 10000,
  };
}

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
      renewalPeriod,
      numberOfSessions,
      locationId,
    } = req.body;
    if (!name || !category || !price)
      throw new BadRequestError("INVALID_REQUEST", "Invalid request");
    if (category === "OPEN_GYM") {
      if (!locationId || !Types.ObjectId.isValid(locationId)) {
        throw new BadRequestError(
          "LOCATION_REQUIRED",
          "Open gym packages require a branch locationId",
        );
      }
    }

    const normalized = normalizeOpenGymPackageFields({
      category,
      expiryPeriod,
      renewalPeriod,
      numberOfSessions,
    });

    const pkg = new Package({
      name,
      numberOfSessions: normalized.numberOfSessions,
      category,
      price,
      expiryPeriod: normalized.expiryPeriod,
      renewalPeriod: normalized.renewalPeriod,
      coachId,
      opensClasses,
      classRestrictions,
      ...(locationId
        ? { locationId: new Types.ObjectId(locationId) }
        : {}),
    });
    await pkg.save();
    new SuccessResponse("Package Added!", pkg).send(res);
  }
);

export const deletePackage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const pkg = await Package.findByIdAndDelete(id);
    if (!pkg)
      throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", { id });
    new SuccessResponse("Package Deleted!", pkg).send(res);
  }
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

    const merged = {
      category: req.body.category ?? existing.category,
      expiryPeriod: req.body.expiryPeriod ?? existing.expiryPeriod,
      renewalPeriod: req.body.renewalPeriod ?? existing.renewalPeriod,
      numberOfSessions: req.body.numberOfSessions ?? existing.numberOfSessions,
    };
    const normalized = normalizeOpenGymPackageFields(merged);
    const updatePayload = {
      ...req.body,
      expiryPeriod: normalized.expiryPeriod,
      renewalPeriod: normalized.renewalPeriod,
      numberOfSessions: normalized.numberOfSessions,
    };

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
  const { uid, pkgId, pkgStartDate, paymentMethod, paymentDate, amount, note } =
    req.body;
  const targetLocationId = resolveLocationFilter(req) ?? undefined;
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
    targetLocationId
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
      p.pkgStartDate.toDateString() === new Date(pkgStartDate).toDateString()
  );
  if (!pkg)
    throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found", {
      pkgId,
    });

  if (pkgEndDate) {
    pkg.pkgEndDate = new Date(pkgEndDate);

    if (new Date(pkgEndDate) < new Date()) {
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
      p.pkgStartDate.toDateString() === new Date(pkgStartDate).toDateString()
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

  const targetLocationId = resolveLocationFilter(req) ?? undefined;

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
  const { name, phoneNumber, date } = req.query;
  const query: any = {};
  if (name) {
    query.name = { $regex: name, $options: "i" };
  }
  if (phoneNumber) {
    query.phoneNumber = phoneNumber;
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
