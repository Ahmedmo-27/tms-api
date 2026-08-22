import { Router } from "express";
import { getClients, getMemberPackages, deductSession, getSchedule, getScans, getPtAttendance, getToday, getNotifications, markNotificationsRead, getDeductionHistory } from "../controllers/coach/dashboard-controller";
import { coachLogin, getCoachMe, changeCoachPassword } from "../controllers/coach/auth-controller";
import { verifyToken } from "../controllers/auth/auth-controller";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { coachGuard } from "../middlewares/coach.middleware";
import { loginLimiter } from "../config/rateLimiter";
import {
  getCoachTickets,
  submitCoachTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";

const router = Router();

router.post("/auth/login", loginLimiter, coachLogin);
router.get("/auth/verifyToken", authenticateUser, authorizeUser(["coach"]), verifyToken);
router.post("/auth/change-password", coachGuard, changeCoachPassword);

router.get("/me", coachGuard, getCoachMe);
router.get("/today", coachGuard, getToday);
router.get("/notifications", coachGuard, getNotifications);
router.patch("/notifications/read", coachGuard, markNotificationsRead);

// Protected — require valid coach JWT
router.get("/clients", coachGuard, getClients);
router.get("/clients/:memberId/packages", coachGuard, getMemberPackages);
router.get("/clients/:memberId/deductions", coachGuard, getDeductionHistory);
router.get("/schedule", coachGuard, getSchedule);
router.get("/scans", coachGuard, getScans);
router.get("/pt-attendance", coachGuard, getPtAttendance);
router.post("/deduct", coachGuard, deductSession);

router.get("/tickets", coachGuard, getCoachTickets);
router.post("/tickets", coachGuard, submitCoachTicket);
router.get("/ticket-categories", coachGuard, getActiveTicketCategories);

export default router;
