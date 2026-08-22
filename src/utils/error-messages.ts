import { Error as MongooseError } from "mongoose";
import {
  ApiError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "../core/ApiError";
import { quoteClassName } from "./booking-package-errors";

const OPEN_GYM_QR_PREFIX = /^opengym:/i;
const PT_QR_PREFIX = /^pt:/i;

export const SCAN_ERROR_MESSAGES = {
  CLASS_NOT_FOUND:
    "This class check-in QR code is not valid. The class may have been cancelled or the QR may be out of date.",
  CLASS_NOT_BOOKED:
    "You are not booked for this class. Please book it in the app before checking in.",
  CLASS_ALREADY_SCANNED:
    "You have already checked in for this class.",
  PAST_ATTENDANCE_DEADLINE:
    "Check-in is closed. Attendance must be recorded within 30 minutes of class start.",
  INVALID_QR:
    "This QR code is not recognized. Please scan a valid class, PT, or open gym check-in code.",
  INVALID_OPEN_GYM_QR:
    "This open gym QR code could not be checked in. Ask staff to confirm you are scanning the branch QR posted at this location.",
  INVALID_PT_QR:
    "This personal training QR code could not be checked in. Ask staff to confirm you are scanning the branch PT QR posted at this location.",
  INVALID_LOCATION:
    "This QR code points to an unknown branch. Please ask staff for a current QR code.",
  MALFORMED_LOCATION_ID:
    "This branch QR code is not formatted correctly. Please ask staff for a current branch QR code.",
  LEGACY_OPEN_GYM_UNAVAILABLE:
    "This open gym QR code is outdated. Please scan the branch-specific QR code posted at this location.",
  NO_ACCESS_AT_LOCATION:
    "Your membership does not include open gym access at this branch.",
  NO_ACTIVE_PACKAGE:
    "You do not have an active package that includes open gym access at this branch.",
  NO_ACTIVE_PT_PACKAGE:
    "You do not have an active personal training package.",
  ATTENDANCE_ALREADY_RECORDED:
    "Open gym attendance has already been recorded for you today at this branch.",
  ATTENDANCE_ALREADY_RECORDED_GENERIC:
    "Open gym attendance has already been recorded for you today.",
  MEMBER_NOT_FOUND: "Your member account could not be found. Please sign in again.",
  PACKAGE_NOT_FOUND:
    "No eligible open gym package is configured. Please contact staff.",
} as const;

export const STAFF_SHEET_ERROR_MESSAGES = {
  NO_PACKAGES_ON_ACCOUNT: "This member has no packages on their account.",
  PACKAGE_DOES_NOT_OPEN_CLASS: (className?: string) =>
    `This member has an active package, but it does not include ${quoteClassName(className)}.`,
  NO_ACTIVE_PACKAGE_FOUND: "This member has no active package.",
  PACKAGE_EXPIRED: (className?: string) =>
    `This member's package for ${quoteClassName(className)} has expired.`,
  NO_REMAINING_SESSIONS: (className?: string) =>
    `This member's package for ${quoteClassName(className)} has no remaining sessions.`,
  CLASS_RESTRICTION_REACHED: (className?: string) =>
    `This member has reached the monthly limit for ${quoteClassName(className)}.`,
  PACKAGE_NOT_YET_ACTIVE: (className?: string) =>
    `This member's package for ${quoteClassName(className)} is not active yet.`,
  NO_CLASS_PACKAGES_CONFIGURED: (className?: string) =>
    `No packages in the catalog open ${quoteClassName(className)} at this branch.`,
  MEMBER_NOT_FOUND: "This member could not be found.",
  CLASS_NOT_FOUND: "This class session could not be found.",
  NO_ACTIVE_PT_PACKAGE:
    "This member does not have an active personal training package.",
  NO_ACTIVE_SPACE_PACKAGE:
    "This member does not have an active package with open gym access at this branch.",
  NO_ACCESS_AT_LOCATION:
    "This member's membership does not include open gym access at this branch.",
} as const;

export function staffSheetErrorFromApi(err: ApiError): {
  code: string;
  message: string;
} {
  const code = err.code || "UNKNOWN_ERROR";
  const className =
    typeof err.context?.className === "string"
      ? err.context.className
      : undefined;

  switch (code) {
    case "NO_PACKAGES_ON_ACCOUNT":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.NO_PACKAGES_ON_ACCOUNT,
      };
    case "PACKAGE_DOES_NOT_OPEN_CLASS":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.PACKAGE_DOES_NOT_OPEN_CLASS(
          className,
        ),
      };
    case "PACKAGE_EXPIRED":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.PACKAGE_EXPIRED(className),
      };
    case "NO_REMAINING_SESSIONS":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.NO_REMAINING_SESSIONS(className),
      };
    case "CLASS_RESTRICTION_REACHED":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.CLASS_RESTRICTION_REACHED(
          className,
        ),
      };
    case "PACKAGE_NOT_YET_ACTIVE":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.PACKAGE_NOT_YET_ACTIVE(className),
      };
    case "NO_CLASS_PACKAGES_CONFIGURED":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.NO_CLASS_PACKAGES_CONFIGURED(
          className,
        ),
      };
    case "NO_ACTIVE_PACKAGE_FOUND":
      if (err.message === SCAN_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE) {
        return {
          code: "NO_ACTIVE_PT_PACKAGE",
          message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE,
        };
      }
      if (err.message === SCAN_ERROR_MESSAGES.NO_ACTIVE_PACKAGE) {
        return {
          code: "NO_ACTIVE_SPACE_PACKAGE",
          message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_SPACE_PACKAGE,
        };
      }
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND,
      };
    case "NO_ACCESS_AT_LOCATION":
      return {
        code,
        message: STAFF_SHEET_ERROR_MESSAGES.NO_ACCESS_AT_LOCATION,
      };
    case "MEMBER_NOT_FOUND":
      return { code, message: STAFF_SHEET_ERROR_MESSAGES.MEMBER_NOT_FOUND };
    case "CLASS_NOT_FOUND":
      return { code, message: STAFF_SHEET_ERROR_MESSAGES.CLASS_NOT_FOUND };
    default:
      break;
  }

  if (err.message === SCAN_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE) {
    return {
      code: "NO_ACTIVE_PT_PACKAGE",
      message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE,
    };
  }
  if (err.message === SCAN_ERROR_MESSAGES.NO_ACTIVE_PACKAGE) {
    return {
      code: "NO_ACTIVE_SPACE_PACKAGE",
      message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_SPACE_PACKAGE,
    };
  }
  if (err.message === SCAN_ERROR_MESSAGES.NO_ACCESS_AT_LOCATION) {
    return { code, message: STAFF_SHEET_ERROR_MESSAGES.NO_ACCESS_AT_LOCATION };
  }
  if (err.message === SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND) {
    return { code, message: STAFF_SHEET_ERROR_MESSAGES.MEMBER_NOT_FOUND };
  }
  if (err.message === SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND) {
    return { code, message: STAFF_SHEET_ERROR_MESSAGES.CLASS_NOT_FOUND };
  }

  return { code, message: err.message };
}

export type InvalidQrReason =
  | "unrecognized"
  | "class_not_found"
  | "malformed_id";

export function getInvalidQrCodeMessage(
  attendanceId: string,
  reason: InvalidQrReason,
): string {
  if (OPEN_GYM_QR_PREFIX.test(attendanceId)) {
    return SCAN_ERROR_MESSAGES.INVALID_OPEN_GYM_QR;
  }

  if (PT_QR_PREFIX.test(attendanceId)) {
    return SCAN_ERROR_MESSAGES.INVALID_PT_QR;
  }

  switch (reason) {
    case "class_not_found":
      return SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND;
    case "malformed_id":
      return SCAN_ERROR_MESSAGES.INVALID_QR;
    case "unrecognized":
    default:
      return SCAN_ERROR_MESSAGES.INVALID_QR;
  }
}

function isCastError(err: Error): err is MongooseError.CastError {
  return err.name === "CastError";
}

function isValidationError(err: Error): err is MongooseError.ValidationError {
  return err.name === "ValidationError";
}

function castErrorToApiError(
  err: MongooseError.CastError,
  context: Record<string, unknown>,
): ApiError {
  const castErr = err as MongooseError.CastError & {
    model?: string | { modelName?: string };
  };
  const modelName =
    typeof castErr.model === "string"
      ? castErr.model
      : castErr.model?.modelName;
  const value = String(err.value ?? "");

  if (
    (modelName === "ScheduledClass" || err.path === "_id") &&
    OPEN_GYM_QR_PREFIX.test(value)
  ) {
    return new BadRequestError(
      "INVALID_OPEN_GYM_QR",
      SCAN_ERROR_MESSAGES.INVALID_OPEN_GYM_QR,
      { ...context, attendanceId: value },
    );
  }

  if (
    (modelName === "ScheduledClass" || err.path === "_id") &&
    PT_QR_PREFIX.test(value)
  ) {
    return new BadRequestError(
      "INVALID_PT_QR",
      SCAN_ERROR_MESSAGES.INVALID_PT_QR,
      { ...context, attendanceId: value },
    );
  }

  if (err.path === "_id" || err.path?.endsWith("Id")) {
    const resource =
      modelName === "ScheduledClass"
        ? "class"
        : modelName === "Location"
          ? "branch"
          : modelName === "Member"
            ? "member"
            : "record";

    return new NotFoundError(
      "INVALID_ID",
      `The ${resource} referenced in this request could not be found.`,
      { ...context, path: err.path, value },
    );
  }

  return new BadRequestError(
    "INVALID_DATA",
    "Some of the provided information is not in a valid format.",
    { ...context, path: err.path, value },
  );
}

export function normalizeToApiError(
  err: Error,
  context: Record<string, unknown> = {},
): ApiError {
  if (err instanceof ApiError) {
    return err;
  }

  if (isCastError(err)) {
    return castErrorToApiError(err, context);
  }

  if (isValidationError(err)) {
    const firstError = Object.values(err.errors)[0];
    return new BadRequestError(
      "VALIDATION_ERROR",
      firstError?.message ?? "Some of the provided information is not valid.",
      context,
    );
  }

  return new InternalError(
    "INTERNAL_ERROR",
    "Something went wrong. Please try again or contact staff if the problem continues.",
    {
      ...context,
      originalError: {
        name: err.name,
        message: err.message,
      },
    },
  );
}
