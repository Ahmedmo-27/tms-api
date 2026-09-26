import { AuthRequest, AuthResponse } from "../../middlewares/auth.middleware";
import { Request, RequestHandler, Response } from "express";
import Member from "../../models/member";
import { InternalError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import logger from "../../config/logger";
import { PackageStatusService } from "../../services/package-status-service";

import User from "../../models/user";

export const getMemberProfile: RequestHandler = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id;

  let member = await Member.findOne({ uid: _id })
    .populate({ path: "uid", select: "-password -tokens -resetCode -fcmTokens" })
    .populate({ path: "packages.pkgId" });

  const hasActivePackages =
    member &&
    Array.isArray(member.packages) &&
    member.packages.some(
      (p: any) =>
        p.status === "ACTIVE" ||
        p.status === "FROZEN" ||
        (typeof p.remainingClasses === "number" && p.remainingClasses > 0)
    );

  const isMember = authReq.user.role === "member" || Boolean(hasActivePackages);

  if (hasActivePackages && authReq.user.role !== "member") {
    authReq.user.role = "member";
    await User.findByIdAndUpdate(_id, { role: "member" });
  }

  if (!member && !isMember) {
    new SuccessResponse("Member Found!", {
      uid: _id,
      packages: [],
      bookings: [],
      attendance: [],
      isActive: true,
      pendingApproval: true,
      isMember: false,
      role: "user",
    }).send(res);
    return;
  }

  if (!member && isMember) {
    member = new Member({
      uid: _id,
      packages: [],
      bookings: [],
      attendance: [],
      isActive: true,
    });
    await member.save();
    await member.populate({ path: "uid", select: "-password -tokens -resetCode -fcmTokens" });
  }

  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { _id });

  const isDirty = PackageStatusService.syncMemberPackageStatuses(member);
  if (isDirty) {
    await member.save();
  }

  member = await Member.populate(member, {
    path: "bookings.scid",
    model: "ScheduledClass",
    populate: [
      { path: "coachId", model: "Coach" },
      {
        path: "cid",
        model: "Class",
        populate: { path: "locations", model: "Location" },
      },
    ],
  });

  member.bookings = member.bookings.filter(
    (b) => b.scid && typeof b.scid === "object" && b.scid._id
  );

  member.packages = member.packages.filter(
    (p: any) =>
      p.status !== "DELETED" &&
      p.pkgId &&
      typeof p.pkgId === "object" &&
      p.pkgId._id
  );
  const memberObj: any = member.toObject ? member.toObject() : { ...member };
  memberObj.isMember = isMember;
  memberObj.role = isMember ? "member" : "user";
  memberObj.pendingApproval = !isMember;
  if (memberObj.uid && typeof memberObj.uid === "object") {
    memberObj.uid.role = isMember ? "member" : "user";
  }
  new SuccessResponse("Member Found!", memberObj).send(res);
});
