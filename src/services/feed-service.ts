import RamadanPost, { IRamadanPost } from "../models/ramadanPost";
import { ClientSession } from "mongoose";
import { runInTransaction } from "../utils/transaction";
import logger from "../config/logger";

interface IPaginationOptions {
  page?: number; // default 1
  limit?: number; // default 10
}

export class FeedService {
  // Create a new post
  static async createPost(
    uid: string,
    task: string,
    url: string,
    time?: Date,
  ): Promise<void> {
    const postTime = time || new Date();

    let newPost: IRamadanPost | null = null;

    await runInTransaction(async (session: ClientSession) => {
      await RamadanPost.create([{ uid, task, url, time: postTime }], {
        session,
      });
    });
  }

  static async likePost(uid: string, postId: string): Promise<void> {
    await runInTransaction(async (session: ClientSession) => {
      const post = await RamadanPost.findById(postId).session(session);
      if (!post) {
        throw new Error("Post not found");
      }

      // Check if user already liked the post
      if (post.likes.includes(uid)) {
        throw new Error("You have already liked this post");
      }

      post.likes.push(uid);
      await post.save({ session });
    });
  }
  // Get all posts for a user
  static async getUserPosts(uid: string): Promise<IRamadanPost[]> {
    return await RamadanPost.find({ uid }).sort({ time: -1 }); // latest first
  }

  static async getAllPosts(options?: IPaginationOptions): Promise<{
    posts: IRamadanPost[];
    total: number;
    page: number;
    pages: number;
  }> {
    const page = options?.page && options.page > 0 ? options.page : 1;
    const limit = options?.limit && options.limit > 0 ? options.limit : 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await RamadanPost.countDocuments();

    // Fetch posts with skip & limit
    const posts = await RamadanPost.find()
      .sort({ time: -1 })
      .skip(skip)
      .limit(limit)
      .populate("uid", "name")
      .populate("likes", "name");

    logger.info("Fetched global feed", { page, limit, total });

    return {
      posts,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }
}
