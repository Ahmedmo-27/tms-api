import { Types } from "mongoose";
import {
  getInvalidQrCodeMessage,
  normalizeToApiError,
  SCAN_ERROR_MESSAGES,
} from "./error-messages";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "../core/ApiError";

describe("getInvalidQrCodeMessage", () => {
  it("returns open gym guidance for branch QR payloads", () => {
    const locationId = new Types.ObjectId().toString();
    expect(getInvalidQrCodeMessage(`opengym:${locationId}`, "unrecognized")).toBe(
      SCAN_ERROR_MESSAGES.INVALID_OPEN_GYM_QR,
    );
  });

  it("returns PT guidance for branch PT QR payloads", () => {
    const locationId = new Types.ObjectId().toString();
    expect(getInvalidQrCodeMessage(`pt:${locationId}`, "unrecognized")).toBe(
      SCAN_ERROR_MESSAGES.INVALID_PT_QR,
    );
  });

  it("returns class-specific guidance when a class QR is not found", () => {
    expect(
      getInvalidQrCodeMessage(new Types.ObjectId().toString(), "class_not_found"),
    ).toBe(SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND);
  });
});

describe("normalizeToApiError", () => {
  it("passes through existing ApiError instances", () => {
    const original = new NotFoundError("CLASS_NOT_FOUND", "Class not found");
    expect(normalizeToApiError(original)).toBe(original);
  });

  it("maps open gym ScheduledClass cast errors to a friendly bad request", () => {
    const castError = new Error(
      'Cast to ObjectId failed for value "opengym:69ec4abad8394559ce7ca77c" (type string) at path "_id" for model "ScheduledClass"',
    );
    castError.name = "CastError";
    Object.assign(castError, {
      path: "_id",
      value: "opengym:69ec4abad8394559ce7ca77c",
      model: { modelName: "ScheduledClass" },
    });

    const apiError = normalizeToApiError(castError);
    expect(apiError).toBeInstanceOf(BadRequestError);
    expect(apiError.code).toBe("INVALID_OPEN_GYM_QR");
    expect(apiError.message).toBe(SCAN_ERROR_MESSAGES.INVALID_OPEN_GYM_QR);
  });

  it("maps generic id cast errors to not found", () => {
    const castError = new Error(
      'Cast to ObjectId failed for value "not-an-id" (type string) at path "_id" for model "ScheduledClass"',
    );
    castError.name = "CastError";
    Object.assign(castError, {
      path: "_id",
      value: "not-an-id",
      model: { modelName: "ScheduledClass" },
    });

    const apiError = normalizeToApiError(castError);
    expect(apiError).toBeInstanceOf(NotFoundError);
    expect(apiError.code).toBe("INVALID_ID");
    expect(apiError.message).toContain("class");
  });

  it("maps validation errors to bad request with field detail", () => {
    const validationError = new Error("Validation failed");
    validationError.name = "ValidationError";
    Object.assign(validationError, {
      errors: {
        email: { message: "Email is required" },
      },
    });

    const apiError = normalizeToApiError(validationError);
    expect(apiError).toBeInstanceOf(BadRequestError);
    expect(apiError.code).toBe("VALIDATION_ERROR");
    expect(apiError.message).toBe("Email is required");
  });

  it("hides unknown internal error details from clients", () => {
    const apiError = normalizeToApiError(new Error("database socket timeout"));
    expect(apiError).toBeInstanceOf(InternalError);
    expect(apiError.message).not.toContain("socket timeout");
    expect(apiError.context.originalError?.message).toBe(
      "database socket timeout",
    );
  });
});
