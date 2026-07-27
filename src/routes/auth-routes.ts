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
} from "../controllers/auth/auth-controller";
import {
  authorizeUser,
  authenticateUser,
} from "../middlewares/auth.middleware";
import {loginLimiter, resetPasswordGlobalLimiter, resetPasswordLimiter} from "../config/rateLimiter";

const authRoutes = express.Router();

authRoutes.get("/", authenticateUser, authorizeUser(["management", "branch_admin"]), getUser);
authRoutes.delete(
  "/",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "member"]),
  deactivateAccount
);
authRoutes.post("/register", registerUser);
authRoutes.post("/register-manually", registerUserManually);
authRoutes.post("/login", loginLimiter, loginUser);
authRoutes.get("/logout", authenticateUser, logoutUser);
authRoutes.get("/logout-all", authenticateUser, logoutFromAllDevices);
authRoutes.post("/reset-password", sendResetCode);
authRoutes.post("/confirm-password-reset", confirmPasswordReset);
authRoutes.get("/verifyToken", authenticateUser, verifyToken)

export default authRoutes;
