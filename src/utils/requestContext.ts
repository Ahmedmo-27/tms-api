import { Request } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";

export interface RequestContextOptions {
  includeBody?: boolean;
  includeQuery?: boolean;
  includeParams?: boolean;
  includeHeaders?: boolean;
  sensitiveFields?: string[];
}

const DEFAULT_SENSITIVE = [
  "password",
  "token",
  "authorization",
  "cookie",
  "resetcode",
  "resetCode",
  "fcmtoken",
  "fcmToken",
];

export function sanitizeObject(obj: any, sensitiveFields: string[]): any {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, sensitiveFields));
  }

  const sensitiveLower = new Set(sensitiveFields.map((f) => f.toLowerCase()));
  const sanitizedObj: any = {};
  for (const key in obj) {
    if (sensitiveLower.has(key.toLowerCase())) {
      sanitizedObj[key] = "[REDACTED]";
    } else {
      sanitizedObj[key] = sanitizeObject(obj[key], sensitiveFields);
    }
  }
  return sanitizedObj;
}

export function getRequestContext(
  req: Request,
  options: RequestContextOptions = {}
): Record<string, any> {
  const {
    includeBody = true,
    includeQuery = true,
    includeParams = true,
    includeHeaders = false,
    sensitiveFields = DEFAULT_SENSITIVE,
  } = options;

  const context: Record<string, any> = {
    url: req.url,
    method: req.method,
    path: req.path,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  };

  const authReq = req as AuthRequest;
  if (authReq.user) {
    context.user = {
      uid: authReq.user._id,
      email: authReq.user.email,
      role: authReq.user.role,
    };
    if (authReq.deviceType) {
      context.deviceType = authReq.deviceType;
    }
  }

  if (includeBody) context.body = sanitizeObject(req.body, sensitiveFields);
  if (includeQuery) context.query = sanitizeObject(req.query, sensitiveFields);
  if (includeParams) context.params = sanitizeObject(req.params, sensitiveFields);
  if (includeHeaders) {
    context.headers = sanitizeObject(req.headers, sensitiveFields);
  }

  return context;
}
