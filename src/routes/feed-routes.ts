import express from "express";
import {
  createPost,
  getGlobalFeed,
  likePost,
} from "../controllers/client/feed-controller";
import { authenticateUser } from "../middlewares/auth.middleware";
import { authorizeUser } from "../middlewares/auth.middleware";
import { checkChallengeSubscription } from "../middlewares/challenge.middleware";

const router = express.Router();

// Create a post
router.post(
  "/",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  createPost,
);

router.post(
  "/like",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  likePost,
)

// Get global feed
router.get(
  "/global",
  authenticateUser,
  authorizeUser(["member", "user"]),
  checkChallengeSubscription(),
  getGlobalFeed,
);

export default router;
