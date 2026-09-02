import { Request, Response } from "express";
import { Types } from "mongoose";
import Member from "../../models/member";
import User from "../../models/user";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { runInTransaction } from "../../utils/transaction";
import { escapeRegex } from "../../utils/escapeRegex";

export const addMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const id = req.params.id;
  const user = await User.findById(id);
  if (!user)
    throw new NotFoundError("USER_NOT_FOUND", "User not found", { id });

  await runInTransaction(async (session) => {
    let member = await Member.findOne({ uid: id }).session(session ?? null);
    if (!member) {
      member = new Member({
        uid: id,
        packages: [],
        bookings: [],
        attendance: [],
      });
      await member.save(session ? { session } : {});
    }
    user.role = "member";
    await user.save(session ? { session } : {});

    await SubscriptionsService.transferStagedPackagesToMember(
      id,
      user.phoneNumber,
      session
    );
  });

  const member = await Member.findOne({ uid: id }).lean();
  new SuccessResponse("Member Added!", member).send(res);
});

export const getMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  // Our Members is intentionally global — all staff roles see members across branches.
  const { uid, limit = "10", page = "1", name, phone, search, pkgId } = req.query;

  const searchTerm = (search || name || phone) ? String(search || name || phone).trim() : "";
  const userQuery: any = {};
  if (uid) {
    userQuery._id = uid;
  }
  if (searchTerm) {
    const escaped = escapeRegex(searchTerm);
    const cleanPhone = searchTerm.replace(/[\s\-+]/g, "");
    const orConditions: any[] = [
      { name: { $regex: escaped, $options: "i" } },
      { phoneNumber: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
    if (cleanPhone && cleanPhone !== searchTerm) {
      orConditions.push({ phoneNumber: { $regex: escapeRegex(cleanPhone), $options: "i" } });
    }
    userQuery.$or = orConditions;
  }

  const users = await User.find(userQuery).select("_id");
  if (!users || users.length === 0) {
    new SuccessResponse("No members found", { members: [], total: 0 }).send(res);
    return;
  }

  const uids = users.map((user) => user._id);

  const pageNumber = parseInt(page as string, 10);
  const limitNumber = parseInt(limit as string, 10);
  const skip = (pageNumber - 1) * limitNumber;

  const memberQuery: any = {
    uid: { $in: uids },
    isActive: { $ne: false },
  };

  if (pkgId && Types.ObjectId.isValid(pkgId as string)) {
    memberQuery.packages = {
      $elemMatch: {
        pkgId: new Types.ObjectId(pkgId as string),
        status: "ACTIVE",
      },
    };
  }

  let [members, total] = await Promise.all([
    Member.find(memberQuery)
      .populate({ path: "uid", select: "-password -tokens -resetCode -fcmTokens" })
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

  members = members.filter((m) => m && m.uid != null);

  members.forEach((member) => {
    if (member.bookings) {
      member.bookings = member.bookings.filter(
        (b) => b.scid && typeof b.scid === "object" && b.scid._id
      );
    }
  });

  new SuccessResponse("Members Found!", { members, total }).send(res);
});
