import { sendPasswordResetEmail } from "../../services/email-service";
import { Request, Response, CookieOptions } from "express";
import User from "../../models/user";
import Member from "../../models/member";
import Coach from "../../models/coach";
import logger from "../../config/logger";
import { AuthRequest } from "../../middlewares/auth.middleware";
import {
  ConflictError,
  ForbiddenError,
  BadRequestError,
  NotFoundError,
} from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import Package from "../../models/package";
import ScheduledClass from "../../models/scheduledClass";
import { Types } from "mongoose";

export const verifyToken = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    new SuccessResponse("Token Verified", {
      user: (req as AuthRequest).user,
    }).send(res);
  }
);

export const registerUserManually = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, phoneNumber, password } = req.body;
    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");
    if (await User.findOne({ phoneNumber: cleanPhoneNumber }))
      throw new ConflictError("USER_ALREADY_EXISTS", "User already exists", {
        phoneNumber,
      });
    const userData = {
      name,
      email: `${name.toLowerCase().replace(/\s/g, "")}@devdefault.com`,
      password,
      phoneNumber: cleanPhoneNumber,
      role: "member",
    };
    const user = new User(userData);
    await user.save();
    const member = new Member({
      uid: user._id,
      packages: [],
      bookings: [],
      attendance: [],
    });
    await member.save();
    new SuccessResponse("User Added!", { user }).send(res);
  }
);

export const registerUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, phoneNumber, role, fcmToken } = req.body;
    //Verify fcmToken here
    const deviceType = req.headers["x-device-type"] ? "mobile" : "web";
    logger.info("Started user registeration", {
      data: { name, email, phoneNumber, role },
    });
    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");

    // Check if user exists with phone
    if (await User.findOne({ phoneNumber: cleanPhoneNumber }))
      throw new ConflictError("PHONE_ALREADY_EXISTS", "Phone number already exists", {
        phoneNumber,
      });

    // Check if user exists with email
    if (await User.findOne({ email: email.toLowerCase() }))
      throw new ConflictError("EMAIL_ALREADY_EXISTS", "Email already exists", {
        email,
      });

    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      phoneNumber: cleanPhoneNumber,
      role,
    });
    await user.save();
    const token = await user.generateAuthToken(deviceType, fcmToken);
    if (deviceType == "web") {
      const isProd = process.env.NODE_ENV === "production";
      const cookieOptions: CookieOptions = {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? ("none" as "none" | "lax" | "strict") : ("lax" as "none" | "lax" | "strict"),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      };
      res.cookie("token", token, cookieOptions);
      new SuccessResponse("Web User Registered!", { user, token }).send(res);
    } else {
      new SuccessResponse("Mobile User Registered!", { user, token }).send(res);
    }
  }
);

export const loginUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumber, password, fcmToken } = req.body;
    //verify fcmToken here
    const deviceType = req.headers["x-device-type"] ? "mobile" : "web";
    logger.info("Started user login", {
      data: { phoneNumber, deviceType, fcmToken },
    });
    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");
    const user = await User.findByCredentials(cleanPhoneNumber, password);
    const token = await user.generateAuthToken(deviceType, fcmToken);
    let responseData: any = {
      token,
      userId: String(user._id),
      role: user.role,
      name: user.name,
    };

    if (user.role === "coach") {
      let hasPtSessions = false;
      let hasScheduledClasses = false;
      const coachDoc = await Coach.findOne({ userId: user._id });
      if (coachDoc) {
        const ptPackagesCount = await Package.countDocuments({ coachId: coachDoc._id as Types.ObjectId });
        hasPtSessions = ptPackagesCount > 0;

        const scheduledClassesCount = await ScheduledClass.countDocuments({ coachId: coachDoc._id as Types.ObjectId });
        hasScheduledClasses = scheduledClassesCount > 0;
      }
      responseData.hasPtSessions = hasPtSessions;
      responseData.hasScheduledClasses = hasScheduledClasses;
    }
    if (deviceType == "web") {
      const isProd = process.env.NODE_ENV === "production";
      const cookieOptions: CookieOptions = {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? ("none" as "none" | "lax" | "strict") : ("lax" as "none" | "lax" | "strict"),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      };
      res.cookie("token", token, cookieOptions);
      new SuccessResponse("Web User Logged In!", responseData).send(res);
    } else {
      new SuccessResponse("Mobile User Logged In!", responseData).send(res);
    }
  }
);

export const logoutUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const { fcmToken } = req.body
    logger.info("Started user logout", {
      data: { user: authReq.user },
    });
    const token =
      authReq.deviceType === "web"
        ? authReq.cookies.token
        : authReq.headers.authorization?.split(" ")[1];
    const user = authReq.user;
    await user.removeToken(token, fcmToken);
    if (authReq.deviceType === "web") res.clearCookie("token");
    new SuccessResponse("User Logged Out!", user).send(res);
  }
);

export const logoutFromAllDevices = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    logger.info("Started user logout from all devices", {
      data: { user: authReq.user },
    });
    const user = authReq.user;
    user.removeAllTokens();
    if (authReq.deviceType === "web") res.clearCookie("token");
    new SuccessResponse("User Logged Out From All Devices!", user).send(res);
  }
);

export const sendResetCode = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    if (!email || email === "")
      throw new BadRequestError("INVALID_EMAIL", "Email is required");
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) throw new NotFoundError("USER_NOT_FOUND", "User not found");
    const resetCode = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    user.resetCode = resetCode;
    await user.save();
    await sendPasswordResetEmail(user.email, resetCode);
    new SuccessResponse("Reset code sent!", { email: user.email }).send(res);
  }
);

export const confirmPasswordReset = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { resetCode, password, email } = req.body;
    if (!email || email === "")
      throw new BadRequestError("INVALID_EMAIL", "Email is required");
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) throw new NotFoundError("User not found");
    if (user.resetCode !== resetCode)
      throw new NotFoundError("RESET_REQUEST_NOT_FOUND", "Invalid reset code", {
        resetCode,
      });
    user.password = password;
    user.resetCode = "";
    await user.removeAllTokens();
    await user.save();
    new SuccessResponse("Password reset!", user).send(res);
  }
);

export const deactivateAccount = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const id = authReq.user._id;
    const user = await User.findById(id);
    if (!user)
      throw new NotFoundError("USER_NOT_FOUND", "User not found", { id });
    const member = await Member.findOne({ uid: id });
    if (!member)
      throw new ForbiddenError("NOT_A_MEMBER", "User is not a member yet", {
        uid: id,
        member: user.name,
      });
    member.isActive = false;
    await member.save();
    new SuccessResponse("User Deleted!", user).send(res);
  }
);

export const registerCoachUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, phoneNumber, coachId } = req.body;

    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");

    // Check if user exists with phone
    if (await User.findOne({ phoneNumber: cleanPhoneNumber }))
      throw new ConflictError("PHONE_ALREADY_EXISTS", "Phone number already exists", {
        phoneNumber,
      });

    // Check if user exists with email
    if (await User.findOne({ email: email.toLowerCase() }))
      throw new ConflictError("EMAIL_ALREADY_EXISTS", "Email already exists", {
        email,
      });

    // Verify coach exists and isn't linked
    const coach = await Coach.findById(coachId);
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { id: coachId });
    if (coach.userId) throw new ConflictError("COACH_ALREADY_LINKED", "Coach already has an account");

    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      phoneNumber: cleanPhoneNumber,
      role: "coach",
    });
    await user.save();

    coach.userId = user._id as any;
    coach.phoneNumber = cleanPhoneNumber;
    await coach.save();

    new SuccessResponse("Coach User Registered!", { user }).send(res);
  }
);
