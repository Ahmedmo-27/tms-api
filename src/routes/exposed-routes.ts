import express from "express";
import { getUnlinkedCoaches } from "../controllers/admin/coach-controller";
import { registerCoachUser } from "../controllers/auth/auth-controller";
import { defaultLimiter, loginLimiter } from "../config/rateLimiter";
import {
  submitTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";

import { authenticateUser } from "../middlewares/auth.middleware";
import { verifyCoacheraSignature } from "../middlewares/coachera-auth.middleware";
import { receiveCoacheraIntake } from "../controllers/external/coachera-controller";

const exposedRoutes = express.Router();

exposedRoutes.get(
  "/unlinked-coaches",
  defaultLimiter,
  getUnlinkedCoaches
);
exposedRoutes.post(
  "/register-coach",
  loginLimiter,
  registerCoachUser
);

// Support tickets (public get, authenticated post)
exposedRoutes.get("/ticket-categories", getActiveTicketCategories);
exposedRoutes.post("/tickets", defaultLimiter, authenticateUser, submitTicket);

// Coachera online class payment intake webhook
exposedRoutes.post(
  "/mindspace-intake",
  defaultLimiter,
  verifyCoacheraSignature,
  receiveCoacheraIntake
);
exposedRoutes.post(
  "/coachera/intake",
  defaultLimiter,
  verifyCoacheraSignature,
  receiveCoacheraIntake
);

export default exposedRoutes;
