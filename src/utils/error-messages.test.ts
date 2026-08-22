import { Types } from "mongoose";
import {
  getInvalidQrCodeMessage,
  normalizeToApiError,
  SCAN_ERROR_MESSAGES,
  staffSheetErrorFromApi,
  STAFF_SHEET_ERROR_MESSAGES,
} from "./error-messages";
import {
  BadRequestError,
  ForbiddenError,
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

describe("staffSheetErrorFromApi", () => {
  it("rewrites an active-package/class mismatch into staff copy with the class name", () => {
    const err = new ForbiddenError(
      "PACKAGE_DOES_NOT_OPEN_CLASS",
      'No active package includes "Mat Pilates 9 am".',
      { className: "Mat Pilates 9 am" },
    );
    expect(staffSheetErrorFromApi(err)).toEqual({
      code: "PACKAGE_DOES_NOT_OPEN_CLASS",
      message: STAFF_SHEET_ERROR_MESSAGES.PACKAGE_DOES_NOT_OPEN_CLASS(
        "Mat Pilates 9 am",
      ),
    });
  });

  it("does not call a true empty package list a class mismatch", () => {
    const err = new ForbiddenError(
      "NO_ACTIVE_PACKAGE_FOUND",
      "No active package found.",
    );
    expect(staffSheetErrorFromApi(err)).toEqual({
      code: "NO_ACTIVE_PACKAGE_FOUND",
      message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_PACKAGE_FOUND,
    });
  });

  it("rewrites scan member/class messages for the desk", () => {
    expect(
      staffSheetErrorFromApi(
        new NotFoundError(
          "MEMBER_NOT_FOUND",
          SCAN_ERROR_MESSAGES.MEMBER_NOT_FOUND,
        ),
      ).message,
    ).toBe(STAFF_SHEET_ERROR_MESSAGES.MEMBER_NOT_FOUND);
    expect(
      staffSheetErrorFromApi(
        new NotFoundError("CLASS_NOT_FOUND", SCAN_ERROR_MESSAGES.CLASS_NOT_FOUND),
      ).message,
    ).toBe(STAFF_SHEET_ERROR_MESSAGES.CLASS_NOT_FOUND);
  });

  it("rewrites PT and space scan package messages for the desk", () => {
    expect(
      staffSheetErrorFromApi(
        new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          SCAN_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE,
        ),
      ),
    ).toEqual({
      code: "NO_ACTIVE_PT_PACKAGE",
      message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_PT_PACKAGE,
    });
    expect(
      staffSheetErrorFromApi(
        new ForbiddenError(
          "NO_ACTIVE_PACKAGE_FOUND",
          SCAN_ERROR_MESSAGES.NO_ACTIVE_PACKAGE,
        ),
      ),
    ).toEqual({
      code: "NO_ACTIVE_SPACE_PACKAGE",
      message: STAFF_SHEET_ERROR_MESSAGES.NO_ACTIVE_SPACE_PACKAGE,
    });
  });
});
