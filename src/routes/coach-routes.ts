import { Router } from "express";
import { getClients, getMemberPackages, deductSession, getSchedule, getScans, getPtAttendance, getToday, getNotifications, markNotificationsRead, getDeductionHistory, getClientAttendanceHistory, confirmClassAttendance, getPtAchievementReport } from "../controllers/coach/dashboard-controller";
import { coachLogin, getCoachMe, changeCoachPassword } from "../controllers/coach/auth-controller";
import { verifyToken } from "../controllers/auth/auth-controller";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { coachGuard, requireManagingCoach } from "../middlewares/coach.middleware";
import { loginLimiter } from "../config/rateLimiter";
import {
  getCoachTickets,
  submitCoachTicket,
  getActiveTicketCategories,
} from "../controllers/admin/ticket-controller";
import {
  getClassShadowChecklist,
  updateClassShadowChecklist,
  getManagingShadowCoaches,
  getManagingShadowCoachDetail,
  updateManagingShadowCoachPhase,
  evaluateManagingShadowCoach,
} from "../controllers/coach/shadow-coach-controller";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags, coachTag } from "../cache/response-cache";

const router = Router();

const coachRead = (ttlMs: number, ...extra: string[]) =>
  cacheResponse({
    ttlMs,
    scope: "user",
    tags: (req) => [coachTag(req), ...extra],
  });

const coachWrite = (...extra: string[]) =>
  invalidateCache((req) => [coachTag(req), ...extra]);

router.post("/auth/login", loginLimiter, coachLogin);
router.get("/auth/verifyToken", authenticateUser, authorizeUser(["coach", "managing_coach"]), verifyToken);
router.post("/auth/change-password", coachGuard, coachWrite(), changeCoachPassword);

router.get("/me", coachGuard, coachRead(30_000), getCoachMe);
router.get("/today", coachGuard, coachRead(15_000, CacheTags.schedule), getToday);
router.get("/notifications", coachGuard, coachRead(15_000), getNotifications);
router.patch("/notifications/read", coachGuard, coachWrite(), markNotificationsRead);

// Protected — require valid coach JWT
router.get("/clients", coachGuard, coachRead(20_000), getClients);
router.get("/clients/:memberId/packages", coachGuard, coachRead(20_000), getMemberPackages);
router.get("/clients/:memberId/deductions", coachGuard, coachRead(20_000), getDeductionHistory);
router.get("/clients/:memberId/attendance", coachGuard, coachRead(20_000, CacheTags.attendance), getClientAttendanceHistory);
router.get("/schedule", coachGuard, coachRead(20_000, CacheTags.schedule), getSchedule);
router.get("/scans", coachGuard, coachRead(15_000, CacheTags.attendance), getScans);
router.post("/scans/:scid/confirm-attendance", coachGuard, coachWrite(CacheTags.schedule, CacheTags.attendance), confirmClassAttendance);
router.get("/pt-attendance", coachGuard, coachRead(15_000, CacheTags.attendance), getPtAttendance);
router.post("/deduct", coachGuard, coachWrite(CacheTags.attendance), deductSession);

router.get("/tickets", coachGuard, coachRead(30_000, CacheTags.tickets), getCoachTickets);
router.post("/tickets", coachGuard, coachWrite(CacheTags.tickets), submitCoachTicket);
router.get("/ticket-categories", coachGuard, coachRead(60_000, CacheTags.ticketCategories), getActiveTicketCategories);

// Managing coach reports. The service keeps its own 45s map; this matches that window.
router.get(
  "/managing/pt-achievement",
  coachGuard,
  requireManagingCoach,
  coachRead(45_000, CacheTags.ptAchievement),
  getPtAchievementReport,
);

// Shadow Coach Checklist (lead coach & managing coach)
router.get("/classes/:scid/shadow-checklist", coachGuard, getClassShadowChecklist);
router.patch("/classes/:scid/shadow-checklist", coachGuard, updateClassShadowChecklist);

// Managing Coach — Shadow Coach Program Management
router.get("/managing/shadow-coaches", coachGuard, requireManagingCoach, getManagingShadowCoaches);
router.get("/managing/shadow-coaches/:coachId", coachGuard, requireManagingCoach, getManagingShadowCoachDetail);
router.patch("/managing/shadow-coaches/:coachId/phase", coachGuard, requireManagingCoach, updateManagingShadowCoachPhase);
router.post("/managing/shadow-coaches/:coachId/decision", coachGuard, requireManagingCoach, evaluateManagingShadowCoach);

export default router;
