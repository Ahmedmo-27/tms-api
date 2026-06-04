import { AuthRequest, AuthResponse } from "../../middlewares/auth.middleware";
import { Request, RequestHandler, Response } from "express";
import Member from "../../models/member";
import { InternalError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import logger from "../../config/logger";

export const getMemberProfile: RequestHandler = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const authReq = req as AuthRequest;
  const _id = authReq.user._id;

  let member = await Member.findOne({ uid: _id })
    .populate("uid")
    .populate({ path: "packages.pkgId" });

  if (!member)
    throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found", { _id });

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

  member.packages = member.packages.filter((p: any) => p.status !== "DELETED");
  new SuccessResponse("Member Found!", member).send(res);
});
