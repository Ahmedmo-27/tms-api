import { Request } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";

export interface RequestContextOptions {
  includeBody?: boolean;
  includeQuery?: boolean;
  includeParams?: boolean;
  includeHeaders?: boolean;
  sensitiveFields?: string[];
}

export function getRequestContext(
  req: Request,
  options: RequestContextOptions = {}
): Record<string, any> {
    
    const {
        includeBody = true,
        includeQuery = true,
        includeHeaders = false,
        sensitiveFields = ['password', 'token', 'authorization', 'cookie']
      } = options;
    
      const context: Record<string, any> = {
        url: req.url,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      }

      if((req as AuthRequest) && (req as AuthRequest).user){
        context.user = {
            uid: (req as AuthRequest).user._id,
            email: (req as AuthRequest).user.email,
            role: (req as AuthRequest).user.role,
        };

        if((req as AuthRequest).deviceType){
            context.deviceType = (req as AuthRequest).deviceType;
        }

        if(includeBody) context.body = sanitizeObject(req.body, sensitiveFields);
        if(includeQuery) context.query = sanitizeObject(req.query, sensitiveFields);
        if(includeHeaders) context.headers = sanitizeObject(req.headers, sensitiveFields);
      }

      function sanitizeObject(obj: any, sensitiveFields: string[]): any {
        if (typeof obj !== 'object' || obj === null) return obj;

        const sanitizedObj: any = {};
        for (const key in obj) {
          if (sensitiveFields.includes(key)) {
            sanitizedObj[key] = '[REDACTED]';
          } else {
            sanitizedObj[key] = sanitizeObject(obj[key], sensitiveFields);
          }
        }
        return sanitizedObj;
      }


  return context;
}
