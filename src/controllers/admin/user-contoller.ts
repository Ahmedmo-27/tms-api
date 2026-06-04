import { Request, Response } from "express";
import { SuccessResponse } from "../../core/ApiResponse";
import User from "../../models/user";
import { InternalError, NotFoundError } from "../../core/ApiError";
import asyncHandler from "../../utils/asyncHandler";
import Member from "../../models/member";

export const getUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, phoneNumber, email } = req.query;
    const query: any = {};
    if (name) {
      query.name = { $regex: name, $options: "i" };
    }
    if (phoneNumber) {
      query.phoneNumber = phoneNumber;
    }
    if (email) {
      query.email = email;
    }
    const users = await User.find(query);
    if (!users || users.length === 0) throw new NotFoundError("USERS_NOT_FOUND", "User not found", { query });
    new SuccessResponse("Users Found!", users).send(res);
  }
);


export const getPendingMembers = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { limit, page, name, phone } = req.query;
    const query: any = {}
    if (name) {
      query.name = { $regex: name, $options: "i" };
    }
    if (phone) {
      query.phoneNumber = { $regex: phone, $options: "i" };
    }
    query.role = "user";
    const skip = ((page as any) - 1) * (limit as any);
    const total = (await User.find(query)).length;
    const users = await User.find(query).sort({createdAt: -1}).limit((limit as any) || 10).skip((skip as any) || 0);
    if (!users || users.length === 0) throw new NotFoundError("REQUESTS_NOT_FOUND", "No pending members found");
    new SuccessResponse("Pending Members Found!", {users, total}).send(res);
  }
);

