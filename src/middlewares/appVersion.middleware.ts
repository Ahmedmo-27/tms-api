import { Request, Response, NextFunction } from "express";
import { BadRequestError, ForbiddenError } from "../core/ApiError";

export const DEFAULT_LATEST_APP_VERSION = "1.0.12";
export const DEFAULT_MIN_REQUIRED_APP_VERSION = "1.0.10";
export const DEFAULT_IOS_STORE_URL =
  "https://apps.apple.com/eg/app/the-mind-space/id6738055505";
export const DEFAULT_ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.themindspace.android";

export const UPDATE_REMINDER_MESSAGE =
  "Please update The Mind Space app from the App Store or Google Play Store for the latest fixes.";
export const FORCE_UPDATE_MESSAGE =
  "Please update The Mind Space app from the App Store or Google Play Store to continue using the app.";

export interface AppVersionEvaluation {
  clientVersion: string | null;
  latestVersion: string;
  minRequiredVersion: string;
  blockMissingVersion: boolean;
  isMissingVersion: boolean;
  updateAvailable: boolean;
  forceUpdate: boolean;
  title: string;
  message: string;
  forceMessage: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
}

export interface AppVersionRequest extends Request {
  appVersionInfo?: AppVersionEvaluation;
  isOutdatedMobileApp?: boolean;
}

/**
 * Compare two semantic version strings (e.g. "1.0.10" vs "1.0.11+11").
 * Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2.
 */
export function compareSemver(v1Raw: string, v2Raw: string): number {
  const clean = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split("+")[0]
      .split("-")[0]
      .split(".")
      .map((part) => {
        const n = parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const p1 = clean(v1Raw);
  const p2 = clean(v2Raw);
  const len = Math.max(p1.length, p2.length, 3);

  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0;
    const b = p2[i] ?? 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

export function extractAppVersion(req: Request): string | undefined {
  const headerVersion =
    req.headers["x-app-version"] || req.headers["x-client-version"];
  if (typeof headerVersion === "string" && headerVersion.trim().length > 0) {
    return headerVersion.trim();
  }
  const bodyVersion = (req.body as Record<string, unknown> | undefined)
    ?.appVersion;
  if (typeof bodyVersion === "string" && bodyVersion.trim().length > 0) {
    return bodyVersion.trim();
  }
  const queryVersion = req.query?.appVersion;
  if (typeof queryVersion === "string" && queryVersion.trim().length > 0) {
    return queryVersion.trim();
  }
  return undefined;
}

export function evaluateAppVersion(
  clientVersionRaw?: string,
): AppVersionEvaluation {
  const latestVersion =
    process.env.LATEST_APP_VERSION?.trim() || DEFAULT_LATEST_APP_VERSION;
  const minRequiredVersion =
    process.env.MIN_REQUIRED_APP_VERSION?.trim() ||
    DEFAULT_MIN_REQUIRED_APP_VERSION;
  const blockMissingVersion =
    process.env.BLOCK_MISSING_APP_VERSION?.trim().toLowerCase() === "true";
  const iosStoreUrl =
    process.env.IOS_STORE_URL?.trim() || DEFAULT_IOS_STORE_URL;
  const androidStoreUrl =
    process.env.ANDROID_STORE_URL?.trim() || DEFAULT_ANDROID_STORE_URL;

  const clientVersion =
    clientVersionRaw && clientVersionRaw.trim().length > 0
      ? clientVersionRaw.trim()
      : null;
  const isMissingVersion = clientVersion === null;

  const isBelowLatest =
    !isMissingVersion && compareSemver(clientVersion, latestVersion) < 0;
  const isBelowMinRequired =
    !isMissingVersion && compareSemver(clientVersion, minRequiredVersion) < 0;

  const forceUpdate =
    (isMissingVersion && blockMissingVersion) || isBelowMinRequired;
  const updateAvailable = forceUpdate || isMissingVersion || isBelowLatest;

  return {
    clientVersion,
    latestVersion,
    minRequiredVersion,
    blockMissingVersion,
    isMissingVersion,
    updateAvailable,
    forceUpdate,
    title: forceUpdate ? "Update Required" : "Update Available",
    message:
      "A new version of The Mind Space app is available with important booking fixes. Please update now for the best experience.",
    forceMessage: FORCE_UPDATE_MESSAGE,
    iosStoreUrl,
    androidStoreUrl,
  };
}

export function withUpdateReminder(req: Request, baseMessage: string): string {
  const versionReq = req as AppVersionRequest;
  if (versionReq.isOutdatedMobileApp) {
    return `${baseMessage} (${UPDATE_REMINDER_MESSAGE})`;
  }
  return baseMessage;
}

export const checkMobileAppVersion = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const versionReq = req as AppVersionRequest;
  const evaluation = evaluateAppVersion(extractAppVersion(req));
  versionReq.appVersionInfo = evaluation;
  versionReq.isOutdatedMobileApp = evaluation.updateAvailable;

  if (!evaluation.forceUpdate) {
    next();
    return;
  }

  // On legacy builds (missing x-app-version), CLASS_NOT_FOUND in bookClass displays the message in a red SnackBar
  // without opening the Geidea Drop-In payment modal.
  if (req.method === "POST" && req.path.startsWith("/book/")) {
    const errorCode = evaluation.isMissingVersion
      ? "CLASS_NOT_FOUND"
      : "APP_UPDATE_REQUIRED";
    next(new BadRequestError(errorCode, evaluation.forceMessage));
    return;
  }

  next(new ForbiddenError("APP_UPDATE_REQUIRED", evaluation.forceMessage));
};
