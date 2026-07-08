import { Error as MongooseError } from "mongoose";
import {
  ApiError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "../core/ApiError";

const OPEN_GYM_QR_PREFIX = /^opengym:/i;

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
    "This QR code is not recognized. Please scan a valid class or open gym check-in code.",
  INVALID_OPEN_GYM_QR:
    "This open gym QR code could not be checked in. Ask staff to confirm you are scanning the branch QR posted at this location.",
  INVALID_LOCATION:
    "This open gym QR code points to an unknown branch. Please ask staff for a current QR code.",
  MALFORMED_LOCATION_ID:
    "This open gym QR code is not formatted correctly. Please ask staff for a current branch QR code.",
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
