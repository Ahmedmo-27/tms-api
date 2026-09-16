import { Request, Response } from "express";
import { Types } from "mongoose";
import { SuccessResponse } from "../../core/ApiResponse";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../core/ApiError";
import User from "../../models/user";
import Member from "../../models/member";
import Coach from "../../models/coach";
import asyncHandler from "../../utils/asyncHandler";
import NonUserPackage from "../../models/nonUserPackage";
import { escapeRegex } from "../../utils/escapeRegex";
import { normalizePhoneNumber } from "../../utils/phone";
import { assertPasswordStrength } from "../auth/auth-controller";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { runInTransaction } from "../../utils/transaction";
import { AuthRequest } from "../../middlewares/auth.middleware";

const USER_SAFE_SELECT = "-password -tokens -resetCode -fcmTokens";

export const getUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, phoneNumber, email } = req.query;
    const query: any = {};
    if (name) {
      query.name = { $regex: escapeRegex(String(name)), $options: "i" };
    }
    if (phoneNumber) {
      query.phoneNumber = phoneNumber;
    }
    if (email) {
      query.email = email;
    }
    const users = await User.find(query).select(USER_SAFE_SELECT);
    if (!users || users.length === 0) {
      new SuccessResponse("No users found", []).send(res);
      return;
    }
    new SuccessResponse("Users Found!", users).send(res);
  }
);

export const getPendingMembers = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { limit, page, name, phone, search } = req.query;
    const searchTerm = (search || name || phone) ? String(search || name || phone).trim() : "";
    const query: any = {};
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
      query.$or = orConditions;
    }
    query.role = "user";
    const skip = ((page as any) - 1) * (limit as any);
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select(USER_SAFE_SELECT)
      .sort({ createdAt: -1 })
      .limit((limit as any) || 10)
      .skip((skip as any) || 0);
    if (!users || users.length === 0) {
      new SuccessResponse("No pending members found", { users: [], total: 0 }).send(res);
      return;
    }

    const phoneNumbers = users.map((user) => user.phoneNumber);
    const pendingPackages = await NonUserPackage.find({
      phoneNumber: { $in: phoneNumbers },
      added: { $ne: true },
    }).populate({ path: "pkgId" });

    const usersWithPackages = users.map((user) => {
      const userObj = user.toObject();
      const packagesForUser = pendingPackages.filter(
        (pkg) => pkg.phoneNumber === user.phoneNumber
      );
      return {
        ...userObj,
        pendingPackages: packagesForUser.map((pkg) => ({
          pkgName: (pkg.pkgId as { name?: string })?.name ?? "Unknown",
          remainingClasses: pkg.remainingClasses,
        })),
      };
    });

    new SuccessResponse("Pending Members Found!", { users: usersWithPackages, total }).send(res);
  }
);

export const listUsers = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { page = "1", limit = "25", search, role, locationId } = req.query;
    const query: any = {};

    if (role && role !== "all") {
      query.role = role;
    }

    if (locationId && Types.ObjectId.isValid(locationId as string)) {
      query.locationId = new Types.ObjectId(locationId as string);
    }

    const searchTerm = search ? String(search).trim() : "";
    if (searchTerm) {
      const escaped = escapeRegex(searchTerm);
      const cleanPhone = searchTerm.replace(/[\s\-+]/g, "");
      const orConditions: any[] = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { phoneNumber: { $regex: escaped, $options: "i" } },
      ];
      if (cleanPhone && cleanPhone !== searchTerm) {
        orConditions.push({ phoneNumber: { $regex: escapeRegex(cleanPhone), $options: "i" } });
      }
      query.$or = orConditions;
    }

    const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNumber = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 25));
    const skip = (pageNumber - 1) * limitNumber;

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select(USER_SAFE_SELECT)
      .populate("locationId", "branchName location")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean();

    const coachUserIds = users
      .filter((u) => u.role === "coach" || u.role === "managing_coach")
      .map((u) => u._id);

    const coachMap: Record<string, { _id: string; coachName: string }> = {};
    if (coachUserIds.length > 0) {
      const coaches = await Coach.find({ userId: { $in: coachUserIds } })
        .select("_id coachName userId")
        .lean();
      coaches.forEach((c) => {
        if (c.userId) {
          coachMap[c.userId.toString()] = { _id: c._id.toString(), coachName: c.coachName };
        }
      });
    }

    const enrichedUsers = users.map((user) => ({
      ...user,
      coach: coachMap[user._id.toString()] || null,
    }));

    new SuccessResponse("Users retrieved successfully", {
      users: enrichedUsers,
      total,
      page: pageNumber,
      limit: limitNumber,
    }).send(res);
  }
);

export const createUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      name,
      email,
      phoneNumber,
      password,
      role,
      locationId,
      tmsEmail,
      sendAsName,
      coachId,
    } = req.body;

    if (!name || !email || !phoneNumber || !password || !role) {
      throw new BadRequestError(
        "MISSING_FIELDS",
        "Name, email, phone number, password, and role are required"
      );
    }

    const validRoles = [
      "member",
      "user",
      "admin",
      "management",
      "branch_admin",
      "coach",
      "managing_coach",
      "mailer",
    ];
    if (!validRoles.includes(role)) {
      throw new BadRequestError("INVALID_ROLE", `Role '${role}' is not valid`);
    }

    const cleanPhone = normalizePhoneNumber(phoneNumber);
    if (!/^\d{11}$/.test(cleanPhone)) {
      throw new BadRequestError(
        "INVALID_PHONE_NUMBER",
        "Phone number must be exactly 11 digits"
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,}$/.test(cleanEmail)) {
      throw new BadRequestError("INVALID_EMAIL", "Please enter a valid email address");
    }

    assertPasswordStrength(password);

    if (await User.findOne({ phoneNumber: cleanPhone })) {
      throw new ConflictError(
        "PHONE_ALREADY_EXISTS",
        "Phone number already registered",
        { phoneNumber: cleanPhone }
      );
    }

    if (await User.findOne({ email: cleanEmail })) {
      throw new ConflictError(
        "EMAIL_ALREADY_EXISTS",
        "Email address already registered",
        { email: cleanEmail }
      );
    }

    if (role === "branch_admin") {
      if (!locationId || !Types.ObjectId.isValid(locationId)) {
        throw new BadRequestError(
          "LOCATION_REQUIRED",
          "A valid branch location is required for branch_admin accounts"
        );
      }
    }

    let createdUser: any;
    await runInTransaction(async (session) => {
      const userData: any = {
        name: name.trim(),
        email: cleanEmail,
        password,
        phoneNumber: cleanPhone,
        role,
      };

      if (locationId && Types.ObjectId.isValid(locationId)) {
        userData.locationId = new Types.ObjectId(locationId);
      }

      if (tmsEmail) userData.tmsEmail = String(tmsEmail).trim().toLowerCase();
      if (sendAsName) userData.sendAsName = String(sendAsName).trim();

      const user = new User(userData);
      await user.save(session ? { session } : {});
      createdUser = user;

      if (role === "member") {
        const member = new Member({
          uid: user._id,
          packages: [],
          bookings: [],
          attendance: [],
        });
        await member.save(session ? { session } : {});
        await SubscriptionsService.transferStagedPackagesToMember(
          (user._id as Types.ObjectId).toString(),
          cleanPhone,
          session
        );
      }

      if (role === "coach" || role === "managing_coach") {
        if (coachId && Types.ObjectId.isValid(coachId)) {
          await Coach.findByIdAndUpdate(
            coachId,
            { userId: user._id, phoneNumber: cleanPhone },
            session ? { session } : {}
          );
        } else {
          const existingCoach = await Coach.findOne({
            $or: [{ phoneNumber: cleanPhone }, { coachName: user.name }],
          }).session(session ?? null);

          if (existingCoach && !existingCoach.userId) {
            existingCoach.userId = user._id as Types.ObjectId;
            existingCoach.phoneNumber = cleanPhone;
            await existingCoach.save(session ? { session } : {});
          } else if (!existingCoach) {
            const newCoach = new Coach({
              coachName: user.name,
              phoneNumber: cleanPhone,
              userId: user._id,
            });
            await newCoach.save(session ? { session } : {});
          }
        }
      }
    });

    const populatedUser = await User.findById(createdUser._id)
      .select(USER_SAFE_SELECT)
      .populate("locationId", "branchName location")
      .lean();

    new SuccessResponse("User account created successfully", populatedUser).send(res);
  }
);

export const updateUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("INVALID_ID", "Invalid user ID");
    }

    const user = await User.findById(id);
    if (!user) {
      throw new NotFoundError("USER_NOT_FOUND", "User account not found");
    }

    const {
      name,
      email,
      phoneNumber,
      password,
      role,
      locationId,
      tmsEmail,
      sendAsName,
      coachId,
    } = req.body;

    if (phoneNumber !== undefined) {
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      if (!/^\d{11}$/.test(cleanPhone)) {
        throw new BadRequestError(
          "INVALID_PHONE_NUMBER",
          "Phone number must be exactly 11 digits"
        );
      }
      if (cleanPhone !== user.phoneNumber) {
        const existing = await User.findOne({ phoneNumber: cleanPhone, _id: { $ne: id } });
        if (existing) {
          throw new ConflictError("PHONE_ALREADY_EXISTS", "Phone number already registered");
        }
        user.phoneNumber = cleanPhone;
      }
    }

    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!/^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,}$/.test(cleanEmail)) {
        throw new BadRequestError("INVALID_EMAIL", "Please enter a valid email address");
      }
      if (cleanEmail !== user.email) {
        const existing = await User.findOne({ email: cleanEmail, _id: { $ne: id } });
        if (existing) {
          throw new ConflictError("EMAIL_ALREADY_EXISTS", "Email address already registered");
        }
        user.email = cleanEmail;
      }
    }

    if (name !== undefined && name.trim()) {
      user.name = name.trim();
    }

    if (password) {
      assertPasswordStrength(password);
      user.password = password;
    }

    if (locationId !== undefined) {
      if (!locationId || locationId === "none") {
        user.locationId = undefined;
      } else if (Types.ObjectId.isValid(locationId)) {
        user.locationId = new Types.ObjectId(locationId);
      }
    }

    if (role !== undefined) {
      const validRoles = [
        "member",
        "user",
        "admin",
        "management",
        "branch_admin",
        "coach",
        "managing_coach",
        "mailer",
      ];
      if (!validRoles.includes(role)) {
        throw new BadRequestError("INVALID_ROLE", `Role '${role}' is not valid`);
      }

      if (role === "branch_admin" && !user.locationId) {
        throw new BadRequestError(
          "LOCATION_REQUIRED",
          "Branch admin role requires an assigned branch location"
        );
      }

      user.role = role;

      if (role === "member") {
        const existingMember = await Member.findOne({ uid: user._id });
        if (!existingMember) {
          const newMember = new Member({
            uid: user._id,
            packages: [],
            bookings: [],
            attendance: [],
          });
          await newMember.save();
        }
      }

      if (role === "coach" || role === "managing_coach") {
        if (coachId && Types.ObjectId.isValid(coachId)) {
          await Coach.findByIdAndUpdate(coachId, {
            userId: user._id,
            phoneNumber: user.phoneNumber,
          });
        }
      }
    }

    if (tmsEmail !== undefined) {
      user.tmsEmail = tmsEmail ? String(tmsEmail).trim().toLowerCase() : undefined;
    }
    if (sendAsName !== undefined) {
      user.sendAsName = sendAsName ? String(sendAsName).trim() : undefined;
    }

    await user.save();

    const updatedUser = await User.findById(id)
      .select(USER_SAFE_SELECT)
      .populate("locationId", "branchName location")
      .lean();

    new SuccessResponse("User account updated successfully", updatedUser).send(res);
  }
);

export const deleteUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("INVALID_ID", "Invalid user ID");
    }

    const authReq = req as AuthRequest;
    if (authReq.user && (authReq.user._id as Types.ObjectId).toString() === id) {
      throw new BadRequestError(
        "CANNOT_DELETE_SELF",
        "You cannot delete your own account"
      );
    }

    const user = await User.findById(id);
    if (!user) {
      throw new NotFoundError("USER_NOT_FOUND", "User account not found");
    }

    await Coach.updateMany({ userId: user._id }, { $unset: { userId: 1 } });
    await User.findByIdAndDelete(id);

    new SuccessResponse("User account deleted successfully", { id }).send(res);
  }
);
