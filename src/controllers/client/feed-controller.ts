import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { FeedService } from "../../services/feed-service";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";

// Create post
export const createPost = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { task, time, url } = req.body;

  if (!task) throw new BadRequestError("INVALID_INPUT", "Task is required");

  const post = await FeedService.createPost(
    uid,
    task,
    url,
    time ? new Date(time) : undefined,
  );
  new SuccessResponse("Post created successfully!", post).send(res);
});

export const likePost = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { postId } = req.body;

  if (!postId)
    throw new BadRequestError("INVALID_INPUT", "Post ID is required");

  await FeedService.likePost(uid, postId);
  new SuccessResponse("Post liked successfully!").send(res);
});

// Get user's feed
export const getUserFeed = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;

  const posts = await FeedService.getUserPosts(uid);
  new SuccessResponse("User feed fetched!", posts).send(res);
});

// Get global feed
export const getGlobalFeed = asyncHandler(
  async (req: Request, res: Response) => {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 10;

    const result = await FeedService.getAllPosts({ page, limit });

    new SuccessResponse("Posts fetched successfully!", result).send(res);
  },
);
