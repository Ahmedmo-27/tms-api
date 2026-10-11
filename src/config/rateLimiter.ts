import rateLimit from "express-rate-limit";
import { RequestHandler, Request, Response } from "express";
import logger from "./logger";

const isTest = process.env.NODE_ENV === "test";

// No-op middleware used in place of all rate limiters during testing
const noopLimiter: RequestHandler = (_req, _res, next) => next();

/**
 * 1. Default API Limiter:
 * - Authenticated requests (Bearer tokens from staff dashboard & logged-in mobile members)
 *   get 2,500 requests per 15 minutes, keyed by token so one user never exhausts quota for others.
 * - Unauthenticated guest requests get 300 requests per 15 minutes per IP.
 */
export const defaultLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: (req: Request) => {
        // Generous limit for authenticated staff and app users
        if (req.headers.authorization) {
          return 2500;
        }
        return 300;
      },
      keyGenerator: (req: Request) => {
        const auth = req.headers.authorization;
        if (auth && auth.startsWith("Bearer ")) {
          // Key by token prefix so studio Wi-Fi IP is not shared across all staff members
          return auth.slice(7, 39);
        }
        return req.ip || req.socket.remoteAddress || "global_ip";
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req: Request, res: Response) => {
        logger.warn(`[RATE_LIMIT] Default rate limit exceeded`, {
          ip: req.ip,
          path: req.originalUrl,
          hasAuth: Boolean(req.headers.authorization),
        });
        res.status(429).json({
          statusCode: 429,
          message: "Too many requests. Please wait a moment before trying again.",
          code: "RATE_LIMITED",
        });
      },
    });

/**
 * 2. Login Limiter:
 * - Max 5 attempts per 5 minutes per (IP + Account Identifier).
 * - skipSuccessfulRequests: true ensures successful logins do NOT count against the threshold.
 * - Prevents brute force & credential stuffing while allowing multiple users on the same gym Wi-Fi.
 */
export const loginLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 5, // max 5 attempts per window
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => {
        const account = (
          req.body?.phoneNumber ||
          req.body?.phone ||
          req.body?.email ||
          ""
        )
          .toString()
          .trim()
          .toLowerCase();
        const clientIp = req.ip || req.socket.remoteAddress || "unknown_ip";
        return account ? `${clientIp}_${account}` : clientIp;
      },
      handler: (req: Request, res: Response) => {
        logger.warn(`[SECURITY] Login rate limit exceeded`, {
          ip: req.ip,
          path: req.originalUrl,
          account: req.body?.phoneNumber || req.body?.phone || req.body?.email ? "[PRESENT]" : "none",
        });
        res.status(429).json({
          statusCode: 429,
          message: "Too many failed login attempts. Please wait 5 minutes before trying again.",
          code: "RATE_LIMITED",
        });
      },
    });

/**
 * 3. Password Reset Limiter:
 * - Max 5 reset requests per hour per (IP + Account Identifier).
 */
export const resetPasswordLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 5, // max 5 requests per IP+Account
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => {
        const account = (
          req.body?.phoneNumber ||
          req.body?.phone ||
          req.body?.email ||
          ""
        )
          .toString()
          .trim()
          .toLowerCase();
        const clientIp = req.ip || req.socket.remoteAddress || "unknown_ip";
        return account ? `${clientIp}_${account}` : clientIp;
      },
      handler: (req: Request, res: Response) => {
        logger.warn(`[SECURITY] Password reset limit exceeded`, {
          ip: req.ip,
          path: req.originalUrl,
        });
        res.status(429).json({
          statusCode: 429,
          message: "Too many password reset requests. Please try again in an hour.",
          code: "RATE_LIMITED",
        });
      },
    });

// Global limiter: 495 requests per day shared by all (SMS/Email provider guardrail)
export const resetPasswordGlobalLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
      max: 495,
      keyGenerator: () => "global", // same key for everyone
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req: Request, res: Response) => {
        logger.warn(`[SECURITY] Global password reset limit exceeded`, {
          ip: req.ip,
        });
        res.status(429).json({
          statusCode: 429,
          message: "Daily reset limit reached. Try again tomorrow.",
          code: "GLOBAL_RATE_LIMITED",
        });
      },
    });
