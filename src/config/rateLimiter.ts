import rateLimit from "express-rate-limit";
import { RequestHandler } from "express";

const isTest = process.env.NODE_ENV === "test";

// No-op middleware used in place of all rate limiters during testing
const noopLimiter: RequestHandler = (_req, _res, next) => next();

export const defaultLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // max 100 requests per IP
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: "Too many requests, please try again later.",
        code: "RATE_LIMITED",
      },
    });

export const loginLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 5, // max 5 requests per IP
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: "Too many requests, please try again later.",
        code: "RATE_LIMITED",
      },
    });

export const resetPasswordLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // max 3 requests per IP
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: "Too many requests, please try again later.",
        code: "RATE_LIMITED",
      },
    });

// Global limiter: 495 requests per day shared by all
export const resetPasswordGlobalLimiter = isTest
  ? noopLimiter
  : rateLimit({
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
      max: 495,
      keyGenerator: () => "global", // same key for everyone
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: "Daily reset limit reached. Try again tomorrow.",
        code: "GLOBAL_RATE_LIMITED",
      },
    });
