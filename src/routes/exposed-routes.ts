import express from "express";
import { exposedGetPayments } from "../controllers/admin/payments-controller";
import { getUnlinkedCoaches } from "../controllers/admin/coach-controller";
import { registerCoachUser } from "../controllers/auth/auth-controller";
import { defaultLimiter } from "../config/rateLimiter";
import {
  submitTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";

const exposedRoutes = express.Router();

// exposedRoutes.get("/", exposedGetPayments);
exposedRoutes.get("/unlinked-coaches", getUnlinkedCoaches);
exposedRoutes.post("/register-coach", registerCoachUser);

// Support tickets (public — no auth)
exposedRoutes.get("/ticket-categories", getActiveTicketCategories);
exposedRoutes.post("/tickets", defaultLimiter, submitTicket);

export default exposedRoutes;