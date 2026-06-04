import { Response } from "express";
import logger from "../config/logger";

enum StatusCode {
  SUCCESS = 200,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_ERROR = 500,
  CONFLICT = 409,
}

abstract class ApiResponse {
  constructor(
    protected statusCode: StatusCode,
    protected message: string,
    protected code?: string,
    protected data?: any
  ) {}

  public send(res: Response): Response {
    
    const resData = this;
    if (resData.statusCode === 200) {
      logger.info(resData.message);
    }
    return res.status(this.statusCode).json(resData);
  }
}

export class SuccessResponse extends ApiResponse {
  constructor(message: string, data?: any) {
    super(StatusCode.SUCCESS, message, undefined, data);
  }
}

export class BadRequestResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.BAD_REQUEST, message, code, data);
  }
}

export class UnauthorizedResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.UNAUTHORIZED, message, code, data);
  }
}

export class ForbiddenResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.FORBIDDEN, message, code, data);
  }
}

export class NotFoundResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.NOT_FOUND, message, code, data);
  }
}

export class ConflictResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.CONFLICT, message, code, data);
  }
}

export class InternalErrorResponse extends ApiResponse {
  constructor(message: string, code: string, data?: any) {
    super(StatusCode.INTERNAL_ERROR, message, code, data);
  }
}
