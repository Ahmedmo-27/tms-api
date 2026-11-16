import express from "express";
import { getUser } from "../controllers/admin/user-contoller";
import {
  deactivateAccount,
  loginUser,
  logoutFromAllDevices,
  logoutUser,
  registerUser,
  sendResetCode,
  confirmPasswordReset,
  verifyToken,
  registerUserManually,
  getAppVersionInfo,
} from "../controllers/auth/auth-controller";
import {
  authorizeUser,
  authenticateUser,
} from "../middlewares/auth.middleware";
import {
  loginLimiter,
  resetPasswordGlobalLimiter,
  resetPasswordLimiter,
} from "../config/rateLimiter";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

const authRoutes = express.Router();

authRoutes.get(
  "/app-version",
  cacheResponse({
    ttlMs: 300_000,
    scope: "public",
    tags: [CacheTags.appVersion],
    varyHeaders: ["x-app-version", "x-client-version"],
  }),
  getAppVersionInfo,
);
authRoutes.get(
  "/",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  cacheResponse({ ttlMs: 30_000, scope: "user", tags: [CacheTags.users] }),
  getUser,
);
authRoutes.delete(
  "/",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "member"]),
  invalidateCache([CacheTags.users, CacheTags.members]),
  deactivateAccount
);
authRoutes.post("/register", loginLimiter, registerUser);
authRoutes.post(
  "/register-manually",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.users]),
  registerUserManually
);
authRoutes.post("/login", loginLimiter, loginUser);
authRoutes.get("/logout", authenticateUser, logoutUser);
authRoutes.post("/logout", authenticateUser, logoutUser);
authRoutes.get("/logout-all", authenticateUser, logoutFromAllDevices);
authRoutes.post("/logout-all", authenticateUser, logoutFromAllDevices);
authRoutes.post(
  "/reset-password",
  resetPasswordGlobalLimiter,
  resetPasswordLimiter,
  sendResetCode
);
authRoutes.post(
  "/confirm-password-reset",
  resetPasswordLimiter,
  confirmPasswordReset
);
authRoutes.get("/verifyToken", authenticateUser, verifyToken);

export default authRoutes;
