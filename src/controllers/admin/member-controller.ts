import { Request, Response } from "express";
import Member from "../../models/member";
import User from "../../models/user";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import NonUserPackage from "../../models/nonUserPackage";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { runInTransaction } from "../../utils/transaction";

export const addMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const id = req.params.id;
  const user = await User.findById(id);
  if (!user)
    throw new NotFoundError("USER_NOT_FOUND", "User not found", { id });

  await runInTransaction(async (session) => {
    const member = new Member({
      uid: id,
      packages: [],
      bookings: [],
      attendance: [],
    });
    await member.save(session ? { session } : {});
    user.role = "member";
    await user.save(session ? { session } : {});

    const pkgQuery = NonUserPackage.find({
      phoneNumber: user.phoneNumber,
      added: false,
    });
    if (session) pkgQuery.session(session);
    const savedPkgs = await pkgQuery;

    for (const savedPkg of savedPkgs) {
      await SubscriptionsService.addSavedPkgToMember(
        id,
        savedPkg.pkgId.toString(),
        savedPkg.pkgStartDate.toISOString(),
        savedPkg.remainingClasses,
        savedPkg.pkgEndDate.toISOString(),
        session
      );
      await NonUserPackage.findByIdAndUpdate(
        savedPkg._id,
        { added: true },
        session ? { session } : {}
      );
    }
  });

  const member = await Member.findOne({ uid: id }).lean();
  new SuccessResponse("Member Added!", member).send(res);
});

export const getMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { uid, limit = "10", page = "1", name, phone } = req.query;

  const userQuery: any = {};
  if (uid) {
    userQuery._id = uid;
  }
  if (name) {
    userQuery.name = { $regex: name, $options: "i" };
  }
  if (phone) {
    userQuery.phoneNumber = { $regex: phone, $options: "i" };
  }

  const users = await User.find(userQuery);
  if (!users || users.length === 0)
    throw new NotFoundError("MEMBER_NOT_FOUND", "No members found");

  const uids = users.map((user) => user._id);

  const pageNumber = parseInt(page as string, 10);
  const limitNumber = parseInt(limit as string, 10);
  const skip = (pageNumber - 1) * limitNumber;

  const memberQuery = {
    uid: { $in: uids },
    isActive: true,
  };

  let [members, total] = await Promise.all([
    Member.find(memberQuery)
      .populate("uid")
      .populate({ path: "packages.pkgId" })
      .populate({ path: "ptAttendance.pkgId" })
      .sort({ createdAt: -1 })
      .limit(limitNumber)
      .skip(skip),
    Member.countDocuments(memberQuery),
  ]);

  members = await Member.populate(members, {
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

  members.forEach((member) => {
    member.bookings = member.bookings.filter(
      (b) => b.scid && typeof b.scid === "object" && b.scid._id
    );
  });

  new SuccessResponse("Members Found!", { members, total }).send(res);
});
