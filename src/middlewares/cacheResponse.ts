import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  CacheScope,
  actorOf,
  buildCacheKey,
  cacheGet,
  cacheSet,
  invalidateTags,
} from "../cache/response-cache";

type TagSource = string[] | ((req: Request) => string[]);

export type CacheResponseOptions = {
  ttlMs: number;
  scope: CacheScope;
  tags: TagSource;
  /** Extra request headers that change the body, such as x-app-version. */
  varyHeaders?: string[];
};

function resolveTags(req: Request, tags: TagSource): string[] {
  return typeof tags === "function" ? tags(req) : tags;
}

/**
 * Caches a 200 JSON GET body in memory.
 * Place this after authentication so `user` and `role` scopes can see the caller.
 * Browsers and proxies are told not to store the body; only this process does.
 */
export function cacheResponse(options: CacheResponseOptions): RequestHandler {
  return function cacheResponseMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.method !== "GET") {
      next();
      return;
    }

    if (options.scope !== "public" && !actorOf(req)) {
      next();
      return;
    }

    const baseKey = buildCacheKey(req, options.scope);
    if (!baseKey) {
      next();
      return;
    }
    const vary = (options.varyHeaders ?? [])
      .map((header) => `${header}=${String(req.header(header) ?? "")}`)
      .join("|");
    const key = vary ? `${baseKey}|${vary}` : baseKey;

    res.set("Cache-Control", "private, max-age=0");

    const hit = cacheGet(key);
    if (hit !== undefined) {
      res.set("X-Cache", "HIT");
      res.status(200).json(hit);
      return;
    }

    res.set("X-Cache", "MISS");
    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      if (res.statusCode === 200) {
        cacheSet(key, body, options.ttlMs, resolveTags(req, options.tags));
      }
      return originalJson(body);
    }) as Response["json"];
    next();
  };
}

/**
 * Drops tagged GET entries after a write responds with 2xx.
 * Place it before the controller on POST, PATCH, PUT, and DELETE routes.
 */
export function invalidateCache(tags: TagSource): RequestHandler {
  return function invalidateCacheMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      invalidateTags(resolveTags(req, tags));
    });
    next();
  };
}
