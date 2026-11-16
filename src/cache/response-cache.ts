import type { Request } from "express";

/**
 * In-process store for successful GET bodies.
 * One Node process only: a restart drops it, and a second Railway instance
 * does not see these entries.
 */
export type CacheScope = "public" | "role" | "user";

export const CacheTags = {
  schedule: "schedule",
  packages: "packages",
  classes: "classes",
  coaches: "coaches",
  locations: "locations",
  attendance: "attendance",
  bookings: "bookings",
  members: "members",
  users: "users",
  memberPackages: "member-packages",
  freeze: "freeze",
  payments: "payments",
  refunds: "refunds",
  products: "products",
  orders: "orders",
  tickets: "tickets",
  ticketCategories: "ticket-categories",
  notifications: "notifications",
  mail: "mail",
  sheet: "sheet",
  dropInPrices: "drop-in-prices",
  nonUser: "non-user",
  finance: "finance",
  sales: "sales",
  ptAchievement: "pt-achievement",
  feed: "feed",
  charityPlaces: "charity-places",
  appVersion: "app-version",
} as const;

type CacheEntry = {
  body: unknown;
  expiresAt: number;
  tags: string[];
};

export const cacheLimits = {
  maxEntries: 2000,
  maxBodyBytes: 1_000_000,
};

const store = new Map<string, CacheEntry>();

type Actor = { id: string; role: string };

export function actorOf(req: Request): Actor | null {
  const user = (req as { user?: { _id?: unknown; role?: unknown } }).user;
  if (user?._id != null) {
    return {
      id: String(user._id),
      role: String(user.role ?? "unknown"),
    };
  }
  const coachId = (req as { coachId?: unknown }).coachId;
  if (coachId != null) {
    return { id: String(coachId), role: "coach" };
  }
  return null;
}

export function memberTag(userId: unknown): string {
  return `member:${String(userId)}`;
}

export function challengeTag(userId: unknown): string {
  return `challenge:${String(userId)}`;
}

export function coachTag(req: Request): string {
  const actor = actorOf(req);
  return `coach:${actor?.id ?? "anonymous"}`;
}

/** Path shared by `/member/...` and `/api/member/...`. */
export function normalizeRequestPath(req: Request): string {
  const joined = `${req.baseUrl}${req.path}` || "/";
  const stripped = joined.replace(/^\/api(?=\/|$)/, "");
  return stripped.length > 0 ? stripped : "/";
}

function queryPart(req: Request): string {
  const keys = Object.keys(req.query).sort();
  if (keys.length === 0) return "";
  return keys
    .map((key) => {
      const value = req.query[key];
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${rendered}`;
    })
    .join("&");
}

export function buildCacheKey(req: Request, scope: CacheScope): string | null {
  const path = normalizeRequestPath(req);
  const query = queryPart(req);
  const resource = query ? `${path}?${query}` : path;

  if (scope === "public") {
    return `GET ${resource}|public`;
  }

  const actor = actorOf(req);
  if (!actor) return null;

  if (scope === "role") {
    return `GET ${resource}|role:${actor.role}`;
  }
  return `GET ${resource}|user:${actor.id}:role:${actor.role}`;
}

export function cacheGet(key: string): unknown | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.body;
}

function evictOverflow(): void {
  while (store.size > cacheLimits.maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Stores a JSON-safe clone. Returns false when the body is too large or not serializable. */
export function cacheSet(
  key: string,
  body: unknown,
  ttlMs: number,
  tags: string[],
): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return false;
  }
  if (serialized === undefined) return false;
  if (Buffer.byteLength(serialized, "utf8") > cacheLimits.maxBodyBytes) {
    return false;
  }

  if (store.has(key)) store.delete(key);
  store.set(key, {
    body: JSON.parse(serialized) as unknown,
    expiresAt: Date.now() + ttlMs,
    tags,
  });
  evictOverflow();
  return true;
}

export function invalidateTags(tags: string[]): number {
  if (tags.length === 0) return 0;
  const wanted = new Set(tags);
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.tags.some((tag) => wanted.has(tag))) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Member bookings, profile, and the shared schedule after a member write. */
export function invalidateMemberReadCache(userId: unknown): void {
  invalidateTags([CacheTags.schedule, memberTag(userId)]);
}

/** Member profile, owned packages, and freeze requests after a package write. */
export function invalidateMemberPackageCache(userId: unknown): void {
  invalidateTags([memberTag(userId)]);
}

export function clearResponseCache(): void {
  store.clear();
}

export function responseCacheSize(): number {
  return store.size;
}
