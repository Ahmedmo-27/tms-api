import { Request, Response } from "express";
import Package from "../../models/package";
import Member from "../../models/member";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { logoutUser } from "../auth/auth-controller";
import NonUserPackage from "../../models/nonUserPackage";
import { runInTransaction } from "../../utils/transaction";
import { ClientSession } from "mongoose";

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
  let packages = await Package.find(query)
    .populate({ path: "coachId" })
    .populate({ path: "opensClasses", select: "_id title" });
  if (!packages || packages.length === 0)
    throw new NotFoundError("PACKAGES_NOT_FOUND", "Packages not found");
  new SuccessResponse("Packages Found!", packages).send(res);
});

export const addPackage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      name,
      numberOfSessions = 1000,
      category,
      price,
      expiryPeriod,
      opensClasses,
      coachId,
      classRestrictions,
    } = req.body;
    if (!name || !category || !price || !expiryPeriod)
      throw new BadRequestError("INVALID_REQUEST", "Invalid request");
    const pkg = new Package({
      name,
      numberOfSessions,
      category,
      price,
      expiryPeriod,
      coachId,
      opensClasses,
      classRestrictions,
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
      "opensClasses",
      "hidden",
      "classRestrictions",
    ];
    const updates = Object.keys(req.body);
    const isValidUpdate = updates.every((update) =>
      allowedUpdates.includes(update)
    );
    if (!isValidUpdate)
      throw new BadRequestError("INVALID_UPDATES", "Invalid updates");
    const pkg = await Package.findByIdAndUpdate(id, req.body, { new: true });
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
  const io = req.app.get("io");
  await SubscriptionsService.frontDeskSubscribeToPackage(
    uid,
    pkgId,
    pkgStartDate,
    paymentMethod,
    paymentDate,
    amount,
    note,
    io
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (new Date(pkgEndDate) < new Date()) {
      pkg.status = "EXPIRED";
    } else if (new Date(pkg.pkgStartDate) > today) {
      pkg.status = "POSTPONED";
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
  } = req.body;
  await SubscriptionsService.addNonUserPackage(
    name,
    phoneNumber,
    pkgId,
    pkgStartDate,
    paymentMethod,
    pendingDeduction,
    paymentDate,
    amount
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
