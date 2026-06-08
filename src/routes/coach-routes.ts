import { Router } from "express";
import { coachLogin } from "../controllers/coach/auth-controller";
import { getClients, getMemberPackages, deductSession } from "../controllers/coach/dashboard-controller";
import { verifyToken } from "../controllers/auth/auth-controller";
import { loginLimiter } from "../config/rateLimiter";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { coachGuard } from "../middlewares/coach.middleware";

const router = Router();

router.post("/auth/login", loginLimiter, coachLogin);
router.get("/auth/verifyToken", authenticateUser, authorizeUser(["coach"]), verifyToken);

// Protected — require valid coach JWT
router.get("/clients", coachGuard, getClients);
router.get("/clients/:memberId/packages", coachGuard, getMemberPackages);
router.post("/deduct", coachGuard, deductSession);

export default router;
