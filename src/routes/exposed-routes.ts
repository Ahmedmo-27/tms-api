import express from "express";
import { exposedGetPayments } from "../controllers/admin/payments-controller";
import { getUnlinkedCoaches } from "../controllers/admin/coach-controller";
import { registerCoachUser } from "../controllers/auth/auth-controller";

const exposedRoutes = express.Router();

// exposedRoutes.get("/", exposedGetPayments);
exposedRoutes.get("/unlinked-coaches", getUnlinkedCoaches);
exposedRoutes.post("/register-coach", registerCoachUser);

export default exposedRoutes;