import { sendPasswordResetEmail } from "../../services/email-service";
import { Request, Response } from "express";
import User from "../../models/user";
import Member from "../../models/member";
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
    if (await User.findOne({ phoneNumber: cleanPhoneNumber }))
      throw new ConflictError("USER_ALREADY_EXISTS", "User already exists", {
        phoneNumber,
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
      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      new SuccessResponse("Web User Registered!", { user, token }).send(res);
    } else {
      new SuccessResponse("Mobile User Registered!", { user, token }).send(res);
    }
  }
);

export const loginUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumber, password , fcmToken} = req.body;
    //verify fcmToken here
    const deviceType = req.headers["x-device-type"] ? "mobile" : "web";
    logger.info("Started user login", {
      data: { phoneNumber, deviceType, fcmToken },
    });
    const cleanPhoneNumber = phoneNumber.replace(/\s/g, "");
    const user = await User.findByCredentials(cleanPhoneNumber, password);
    const token = await user.generateAuthToken(deviceType, fcmToken);
    if (deviceType == "web") {
      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      new SuccessResponse("Web User Logged In!", { user, token }).send(res);
    } else {
      new SuccessResponse("Mobile User Logged In!", { user, token }).send(res);
    }
  }
);

export const logoutUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    const {fcmToken} = req.body
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
