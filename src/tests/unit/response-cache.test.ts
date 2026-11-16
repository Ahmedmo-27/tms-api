import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import {
  CacheTags,
  actorOf,
  buildCacheKey,
  cacheGet,
  cacheLimits,
  cacheSet,
  clearResponseCache,
  invalidateMemberReadCache,
  invalidateTags,
  responseCacheSize,
} from "../../cache/response-cache";
import {
  cacheResponse,
  invalidateCache,
} from "../../middlewares/cacheResponse";

function withUser(id: string, role = "member") {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { _id: string; role: string } }).user = {
      _id: id,
      role,
    };
    next();
  };
}

describe("response cache", () => {
  const originalLimits = {
    maxEntries: cacheLimits.maxEntries,
    maxBodyBytes: cacheLimits.maxBodyBytes,
  };

  beforeEach(() => {
    clearResponseCache();
    cacheLimits.maxEntries = originalLimits.maxEntries;
    cacheLimits.maxBodyBytes = originalLimits.maxBodyBytes;
  });

  afterEach(() => {
    jest.useRealTimers();
    clearResponseCache();
    cacheLimits.maxEntries = originalLimits.maxEntries;
    cacheLimits.maxBodyBytes = originalLimits.maxBodyBytes;
  });

  function requestFor(path: string, userId: string, role = "member"): Request {
    return {
      baseUrl: "",
      path,
      query: {},
      user: { _id: userId, role },
    } as unknown as Request;
  }

  it("keeps two user-scoped entries apart", () => {
    const first = requestFor("/member/profile", "user-a");
    const second = requestFor("/member/profile", "user-b");
    const firstKey = buildCacheKey(first, "user");
    const secondKey = buildCacheKey(second, "user");

    expect(firstKey).not.toBe(secondKey);
    cacheSet(firstKey!, { id: "user-a" }, 15_000, ["member:user-a"]);
    cacheSet(secondKey!, { id: "user-b" }, 15_000, ["member:user-b"]);

    expect(cacheGet(firstKey!)).toEqual({ id: "user-a" });
    expect(cacheGet(secondKey!)).toEqual({ id: "user-b" });
  });

  it("drops an entry after its TTL", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
    const key = buildCacheKey(requestFor("/member/locations", "user-a"), "role")!;
    cacheSet(key, { ok: true }, 1_000, [CacheTags.locations]);

    jest.setSystemTime(new Date("2026-11-07T12:00:01.000Z"));
    expect(cacheGet(key)).toBeUndefined();
  });

  it("removes every entry that carries an invalidated tag", () => {
    const schedule = buildCacheKey(requestFor("/member/schedule", "user-a"), "role")!;
    const profile = buildCacheKey(requestFor("/member/profile", "user-a"), "user")!;
    cacheSet(schedule, { classes: 1 }, 20_000, [CacheTags.schedule]);
    cacheSet(profile, { name: "A" }, 15_000, ["member:user-a"]);

    invalidateTags([CacheTags.schedule]);

    expect(cacheGet(schedule)).toBeUndefined();
    expect(cacheGet(profile)).toEqual({ name: "A" });
  });

  it("evicts the oldest entry once the cap is passed", () => {
    cacheLimits.maxEntries = 2;
    const first = buildCacheKey(requestFor("/a", "user-a"), "public")!;
    const second = buildCacheKey(requestFor("/b", "user-a"), "public")!;
    const third = buildCacheKey(requestFor("/c", "user-a"), "public")!;
    cacheSet(first, { n: 1 }, 60_000, ["t"]);
    cacheSet(second, { n: 2 }, 60_000, ["t"]);
    cacheSet(third, { n: 3 }, 60_000, ["t"]);

    expect(responseCacheSize()).toBe(2);
    expect(cacheGet(first)).toBeUndefined();
    expect(cacheGet(third)).toEqual({ n: 3 });
  });

  it("skips bodies larger than the size cap", () => {
    cacheLimits.maxBodyBytes = 20;
    const key = buildCacheKey(requestFor("/member/profile", "user-a"), "user")!;
    const stored = cacheSet(key, { data: "this body is definitely too long" }, 15_000, []);
    expect(stored).toBe(false);
    expect(cacheGet(key)).toBeUndefined();
  });

  it("shares one entry between /member and /api/member", () => {
    const direct = {
      baseUrl: "/member",
      path: "/locations",
      query: {},
      user: { _id: "user-a", role: "member" },
    } as unknown as Request;
    const prefixed = {
      baseUrl: "/api/member",
      path: "/locations",
      query: {},
      user: { _id: "user-b", role: "member" },
    } as unknown as Request;

    expect(buildCacheKey(direct, "role")).toBe(buildCacheKey(prefixed, "role"));
  });

  it("needs an actor for a user-scoped key", () => {
    const anon = { baseUrl: "", path: "/member/profile", query: {} } as Request;
    expect(actorOf(anon)).toBeNull();
    expect(buildCacheKey(anon, "user")).toBeNull();
    expect(buildCacheKey(anon, "public")).toBe("GET /member/profile|public");
  });
});

describe("GET response caching", () => {
  function buildApp() {
    const app = express();
    let locationReads = 0;
    let scheduleReads = 0;

    app.get(
      "/member/locations",
      withUser("shared", "member"),
      cacheResponse({
        ttlMs: 300_000,
        scope: "role",
        tags: [CacheTags.locations],
      }),
      (_req, res) => {
        locationReads += 1;
        res.json({ data: [{ name: "Main" }], reads: locationReads });
      },
    );

    app.get(
      "/member/schedule",
      withUser("shared", "member"),
      cacheResponse({
        ttlMs: 20_000,
        scope: "role",
        tags: [CacheTags.schedule],
      }),
      (_req, res) => {
        scheduleReads += 1;
        res.json({ data: [{ id: "class" }], reads: scheduleReads });
      },
    );

    app.post(
      "/member/book/:scid",
      withUser("shared", "member"),
      (req, _res, next) => {
        invalidateMemberReadCache(
          (req as Request & { user: { _id: string } }).user._id,
        );
        next();
      },
      (_req, res) => {
        res.json({ ok: true });
      },
    );

    app.get(
      "/member/profile",
      (req, res, next) => withUser(String(req.header("x-user") || "user-a"))(req, res, next),
      cacheResponse({
        ttlMs: 15_000,
        scope: "user",
        tags: (req) => [`member:${(req as Request & { user: { _id: string } }).user._id}`],
      }),
      (req, res) => {
        const id = (req as Request & { user: { _id: string } }).user._id;
        res.json({ id });
      },
    );

    app.post(
      "/admin/locations",
      invalidateCache([CacheTags.locations]),
      (_req, res) => {
        res.status(201).json({ created: true });
      },
    );

    return { app, reads: () => ({ locationReads, scheduleReads }) };
  }

  beforeEach(() => clearResponseCache());

  it("returns X-Cache HIT on the second locations read and busts schedule after a booking", async () => {
    const { app, reads } = buildApp();

    const first = await request(app).get("/member/locations");
    const second = await request(app).get("/member/locations");

    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body).toEqual(first.body);
    expect(first.headers["cache-control"]).toBe("private, max-age=0");
    expect(reads().locationReads).toBe(1);

    const scheduleFirst = await request(app).get("/member/schedule");
    expect(scheduleFirst.headers["x-cache"]).toBe("MISS");
    expect(scheduleFirst.body.reads).toBe(1);

    const booked = await request(app).post("/member/book/class-1");
    expect(booked.status).toBe(200);

    const scheduleSecond = await request(app).get("/member/schedule");
    expect(scheduleSecond.headers["x-cache"]).toBe("MISS");
    expect(scheduleSecond.body.reads).toBe(2);
  });

  it("does not let one member read another member's profile from cache", async () => {
    const { app } = buildApp();

    const ada = await request(app).get("/member/profile").set("x-user", "ada");
    const bo = await request(app).get("/member/profile").set("x-user", "bo");
    const adaAgain = await request(app).get("/member/profile").set("x-user", "ada");

    expect(ada.body.id).toBe("ada");
    expect(bo.body.id).toBe("bo");
    expect(bo.headers["x-cache"]).toBe("MISS");
    expect(adaAgain.headers["x-cache"]).toBe("HIT");
    expect(adaAgain.body.id).toBe("ada");
  });

  it("does not cache a failed write and still busts on success", async () => {
    const app = express();
    let reads = 0;
    app.get(
      "/member/locations",
      withUser("shared"),
      cacheResponse({ ttlMs: 300_000, scope: "role", tags: [CacheTags.locations] }),
      (_req, res) => {
        reads += 1;
        res.json({ reads });
      },
    );
    app.post("/admin/locations", invalidateCache([CacheTags.locations]), (_req, res) => {
      res.status(400).json({ ok: false });
    });

    await request(app).get("/member/locations");
    await request(app).post("/admin/locations");
    const cached = await request(app).get("/member/locations");
    expect(cached.headers["x-cache"]).toBe("HIT");
    expect(reads).toBe(1);
  });

  it("keeps app-version responses apart when the client version header differs", async () => {
    const app = express();
    app.get(
      "/auth/app-version",
      cacheResponse({
        ttlMs: 300_000,
        scope: "public",
        tags: [CacheTags.appVersion],
        varyHeaders: ["x-app-version", "x-client-version"],
      }),
      (req, res) => {
        res.json({ version: req.header("x-app-version") ?? "missing" });
      },
    );

    const oldClient = await request(app)
      .get("/auth/app-version")
      .set("x-app-version", "1.0.9");
    const current = await request(app)
      .get("/auth/app-version")
      .set("x-app-version", "1.0.12");
    const oldAgain = await request(app)
      .get("/auth/app-version")
      .set("x-app-version", "1.0.9");

    expect(oldClient.body.version).toBe("1.0.9");
    expect(current.headers["x-cache"]).toBe("MISS");
    expect(current.body.version).toBe("1.0.12");
    expect(oldAgain.headers["x-cache"]).toBe("HIT");
    expect(oldAgain.body.version).toBe("1.0.9");
  });
});
