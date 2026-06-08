import { Router } from "express";
import adminRoutes from "./admin-routes";
import memberRoutes from "./member-routes";
import authRoutes from "./auth-routes";
import challengeRoutes from "./challenge-routes"
import exposedRoutes from "./exposed-routes";
import feedRoutes from "./feed-routes"
import coachRoutes from "./coach-routes"

const router = Router();

router.use("/admin", adminRoutes);
router.use("/member", memberRoutes);
router.use("/auth", authRoutes);
router.use("/challenge", challengeRoutes)
router.use("/feed", feedRoutes)
router.use("/external", exposedRoutes);
router.use("/coach", coachRoutes);

export default router;