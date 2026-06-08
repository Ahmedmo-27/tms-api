import { Router } from "express";
import { getClients, getMemberPackages, deductSession, getSchedule, getScans, getPtAttendance } from "../controllers/coach/dashboard-controller";
import { verifyToken } from "../controllers/auth/auth-controller";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { coachGuard } from "../middlewares/coach.middleware";

const router = Router();

router.get("/auth/verifyToken", authenticateUser, authorizeUser(["coach"]), verifyToken);

// Protected — require valid coach JWT
router.get("/clients", coachGuard, getClients);
router.get("/clients/:memberId/packages", coachGuard, getMemberPackages);
router.get("/schedule", coachGuard, getSchedule);
router.get("/scans", coachGuard, getScans);
router.get("/pt-attendance", coachGuard, getPtAttendance);
router.post("/deduct", coachGuard, deductSession);

export default router;
