import express from "express";
import { getUnlinkedCoaches } from "../controllers/admin/coach-controller";
import { registerCoachUser } from "../controllers/auth/auth-controller";
import { defaultLimiter, loginLimiter } from "../config/rateLimiter";
import {
  submitTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";
import {
  handleCoacheraIntake,
  receiveCoacheraIntake,
} from "../controllers/external/coachera-controller";
import { verifyCoacheraSignature } from "../middlewares/coachera-auth.middleware";
import { authenticateUser } from "../middlewares/auth.middleware";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

const exposedRoutes = express.Router();

exposedRoutes.get(
  "/unlinked-coaches",
  defaultLimiter,
  cacheResponse({ ttlMs: 60_000, scope: "public", tags: [CacheTags.coaches] }),
  getUnlinkedCoaches
);
exposedRoutes.post(
  "/register-coach",
  loginLimiter,
  invalidateCache([CacheTags.coaches]),
  registerCoachUser
);

// Support tickets (public get, authenticated post)
exposedRoutes.get(
  "/ticket-categories",
  cacheResponse({
    ttlMs: 60_000,
    scope: "public",
    tags: [CacheTags.ticketCategories],
  }),
  getActiveTicketCategories,
);
exposedRoutes.post(
  "/tickets",
  defaultLimiter,
  authenticateUser,
  invalidateCache([CacheTags.tickets]),
  submitTicket,
);

// Coachera online class payments intake webhooks
exposedRoutes.post(
  "/coachera-intake",
  defaultLimiter,
  verifyCoacheraSignature,
  handleCoacheraIntake
);
exposedRoutes.post(
  "/mindspace-intake",
  defaultLimiter,
  verifyCoacheraSignature,
  handleCoacheraIntake
);
exposedRoutes.post(
  "/coachera/intake",
  defaultLimiter,
  verifyCoacheraSignature,
  receiveCoacheraIntake
);

export default exposedRoutes;
