import express from "express";
import { getUnlinkedCoaches } from "../controllers/admin/coach-controller";
import { registerCoachUser } from "../controllers/auth/auth-controller";
import { defaultLimiter, loginLimiter } from "../config/rateLimiter";
import {
  submitTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";

import { authenticateUser } from "../middlewares/auth.middleware";

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

export default exposedRoutes;
