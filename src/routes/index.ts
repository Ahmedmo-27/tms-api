import { Router } from "express";
import adminRoutes from "./admin-routes";
import memberRoutes from "./member-routes";
import authRoutes from "./auth-routes";
import challengeRoutes from "./challenge-routes";
import exposedRoutes from "./exposed-routes";
import feedRoutes from "./feed-routes";
import coachRoutes from "./coach-routes";
import financeRoutes from "./finance-routes";
import { handleCoacheraIntake } from "../controllers/external/coachera-controller";
import { verifyCoacheraSignature } from "../middlewares/coachera-auth.middleware";
import { defaultLimiter } from "../config/rateLimiter";
import salesRoutes from "./sales-routes";

const router = Router();

router.use("/admin", adminRoutes);
router.use("/member", memberRoutes);
router.use("/auth", authRoutes);
router.use("/challenge", challengeRoutes);
router.use("/feed", feedRoutes);
router.use("/external", exposedRoutes);
router.use("/coach", coachRoutes);
router.use("/finance", financeRoutes);

// Direct root alias for Coachera intake webhook: POST /mindspace-intake
router.post(
  "/mindspace-intake",
  defaultLimiter,
  verifyCoacheraSignature,
  handleCoacheraIntake
);

router.use("/sales", salesRoutes);
// /api/coach is available via app.use("/api", router) → /api/coach (no double mount)

export default router;