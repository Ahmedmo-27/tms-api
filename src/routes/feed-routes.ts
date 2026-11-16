import express from "express";
import {
  createPost,
  getGlobalFeed,
  likePost,
} from "../controllers/client/feed-controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { authorizeUser } from "../middlewares/auth.middleware";
import { checkChallengeSubscription } from "../middlewares/challenge.middleware";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

const router = express.Router();

// Create a post
router.post(
  "/",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  invalidateCache([CacheTags.feed]),
  createPost,
);

router.post(
  "/like",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  invalidateCache([CacheTags.feed]),
  likePost,
)

// Get global feed
router.get(
  "/global",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  cacheResponse({ ttlMs: 15_000, scope: "user", tags: [CacheTags.feed] }),
  getGlobalFeed,
);

export default router;
