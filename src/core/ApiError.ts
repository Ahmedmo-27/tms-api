import { Response } from "express";
import {
  ForbiddenResponse,
  NotFoundResponse,
  InternalErrorResponse,
  BadRequestResponse,
  UnauthorizedResponse,
  ConflictResponse,
} from "./ApiResponse";
import logger from "../config/logger";

export enum ErrorType {
  BAD_TOKEN = "BadTokenError",
  TOKEN_EXPIRED = "TokenExpiredError",
  UNAUTHORIZED = "AuthFailureError",
  ACCESS_TOKEN = "AccessTokenError",
  INTERNAL = "InternalError",
  NOT_FOUND = "NotFoundError",
  BAD_REQUEST = "BadRequestError",
  FORBIDDEN = "ForbiddenError",
  CONFLICT = "ConflictError",
}

export abstract class ApiError extends Error {
  constructor(
    public type: ErrorType,
    public code: string = "UNKNOWN_ERROR",
    public message: string = "error",
    public context: Record<string, any> = {}
  ) {
    super(type);
  }

  public static handle(error: ApiError, res: Response): Response {
    logger.error(`${error.type}: ${error.code} - ${error.message}`, {
      context: error.context,
      stack: error.stack,
    });
    switch (error.type) {
      case ErrorType.BAD_TOKEN:
      case ErrorType.TOKEN_EXPIRED:
      case ErrorType.UNAUTHORIZED:
      case ErrorType.ACCESS_TOKEN:
        return new UnauthorizedResponse(error.message, error.code).send(res);
      case ErrorType.INTERNAL:
        return new InternalErrorResponse(error.message, error.code).send(res);
      case ErrorType.NOT_FOUND:
        return new NotFoundResponse(error.message, error.code).send(res);
      case ErrorType.BAD_REQUEST:
        return new BadRequestResponse(error.message, error.code).send(res);
      case ErrorType.FORBIDDEN:
        return new ForbiddenResponse(error.message, error.code).send(res);
      case ErrorType.CONFLICT:
        return new ConflictResponse(
          error.message,
          error.code,
          Object.keys(error.context).length > 0 ? error.context : undefined,
        ).send(res);
      default:
        return new InternalErrorResponse(error.message, error.code).send(res);
    }
  }
}

export class AuthFailureError extends ApiError {
  constructor(code: string, message = "Authentication failed", context = {}) {
    super(ErrorType.UNAUTHORIZED, code, message, context);
  }
}

export class NotFoundError extends ApiError {
  constructor(code: string, message = "Not Found", context = {}) {
    super(ErrorType.NOT_FOUND, code, message, context);
  }
}

export class InternalError extends ApiError {
  constructor(code: string, message = "Internal Server Error", context = {}) {
    super(ErrorType.INTERNAL, code, message, context);
  }
}

export class BadRequestError extends ApiError {
  constructor(code: string, message = "Bad Request", context = {}) {
    super(ErrorType.BAD_REQUEST, code, message, context);
  }
}

export class ForbiddenError extends ApiError {
  constructor(code: string, message = "Forbidden", context = {}) {
    super(ErrorType.FORBIDDEN, code, message, context);
  }
}

export class AccessTokenError extends ApiError {
  constructor(code: string, message = "Access Token Error", context = {}) {
    super(ErrorType.ACCESS_TOKEN, code, message, context);
  }
}

export class BadTokenError extends ApiError {
  constructor(code: string, message = "Bad Token", context = {}) {
    super(ErrorType.BAD_TOKEN, code, message, context);
  }
}

export class ConflictError extends ApiError {
  constructor(code: string, message = "Conflict Error", context = {}) {
    super(ErrorType.CONFLICT, code, message, context);
  }
}

export class TokenExpiredError extends ApiError {
  constructor(code: string, message = "Token Expired", context = {}) {
    super(ErrorType.TOKEN_EXPIRED, code, message, context);
  }
}
