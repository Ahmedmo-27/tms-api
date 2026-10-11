import { Types } from "mongoose";
import jwt from "jsonwebtoken";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import { authenticateUser } from "../middlewares/auth.middleware";
import { getMemberProfile } from "../controllers/client/member-controller";
import { getSchedule } from "../controllers/client/class-controller";
import { getAppVersionInfo } from "../controllers/auth/auth-controller";
import {
  checkMobileAppVersion,
  compareSemver,
  evaluateAppVersion,
  withUpdateReminder,
} from "../middlewares/appVersion.middleware";
import { SchedulerService } from "../services/scheduler-service";
import { BadTokenError, ForbiddenError } from "../core/ApiError";

describe("Production Booking & Auth Complaints Regression Suite (50 & Fab Audit)", () => {
  const secret = "test-prod-complaints-jwt-secret";

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("1. Stale 'role: user' JWT & Wiped DB Tokens Self-Healing (Sherina / Deena Sadek Scenario)", () => {
    it("authenticates and self-heals a member whose mobile JWT has stale role='user' and whose DB tokens array was wiped", async () => {
      const uid = new Types.ObjectId();
      // Token minted months ago when user originally signed up with role: "user"
      const staleRoleToken = jwt.sign(
        {
          uid: uid.toString(),
          role: "user",
          deviceType: "mobile",
          jti: "sherin-may-token",
          iat: 1777914070,
          exp: 1777914070 + 3600, // expired months ago
        },
        secret
      );

      const mockSave = jest.fn().mockResolvedValue(true);
      const mockUser: any = {
        _id: uid,
        name: "Sherin Hamed El Assily",
        email: "sherinassily@hotmail.com",
        phoneNumber: "01222101858",
        role: "member", // promoted to member in DB
        tokens: [], // wiped earlier by legacy removeExpiredTokens
        save: mockSave,
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockUser);

      const req: any = {
        headers: { authorization: `Bearer ${staleRoleToken}` },
        cookies: {},
      };
      const res: any = {};
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBe(mockUser);
      expect(req.deviceType).toBe("mobile");
      // Token must be automatically restored into user.tokens as non-expiring mobile token
      expect(mockUser.tokens).toHaveLength(1);
      expect(mockUser.tokens[0]).toEqual({
        token: staleRoleToken,
        device: "mobile",
      });
      expect(mockUser.tokens[0].expiresIn).toBeUndefined();
      expect(mockSave).toHaveBeenCalled();
    });

    it("rejects a web staff/management user if their token is missing from user.tokens in DB", async () => {
      const uid = new Types.ObjectId();
      const staffToken = jwt.sign(
        {
          uid: uid.toString(),
          role: "management",
          deviceType: "web",
          jti: "staff-revoked-token",
        },
        secret,
        { expiresIn: "1d" }
      );

      const mockStaffUser: any = {
        _id: uid,
        role: "management",
        tokens: [], // revoked / logged out
      };

      jest.spyOn(User, "findOne").mockResolvedValue(mockStaffUser);

      const req: any = {
        headers: {},
        cookies: { token: staffToken },
      };
      const res: any = {};
      const next = jest.fn();

      await authenticateUser(req, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(BadTokenError);
      expect(err.code).toBe("INVALID_TOKEN");
    });

    it("auto-promotes user.role from 'user' to 'member' in getMemberProfile when member has an ACTIVE package", async () => {
      const uid = new Types.ObjectId();
      const pkgId = new Types.ObjectId();

      const mockMemberDoc: any = {
        uid: {
          _id: uid,
          name: "Deena Sadek",
          email: "deenas@aucegypt.edu",
          phoneNumber: "01001234567",
          role: "user",
        },
        packages: [
          {
            pkgId: { _id: pkgId, name: "10 Studio" },
            name: "10 Studio",
            status: "ACTIVE",
            remainingClasses: 8,
            pkgStartDate: new Date("2026-09-26T00:00:00Z"),
            pkgEndDate: new Date("2026-11-25T00:00:00Z"),
          },
        ],
        bookings: [],
        attendance: [],
        save: jest.fn().mockResolvedValue(true),
        toObject() {
          return {
            uid: this.uid,
            packages: this.packages,
            bookings: this.bookings,
            attendance: this.attendance,
          };
        },
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockMemberDoc),
        }),
      } as any);
      jest.spyOn(Member, "populate").mockResolvedValue(mockMemberDoc as any);
      const updateSpy = jest
        .spyOn(User, "findByIdAndUpdate")
        .mockResolvedValue({} as any);

      const req: any = {
        user: {
          _id: uid,
          name: "Deena Sadek",
          email: "deenas@aucegypt.edu",
          phoneNumber: "01001234567",
          role: "user",
        },
      };
      let responsePayload: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => {
          responsePayload = body;
        }),
      };

      await getMemberProfile(req, res, jest.fn());

      expect(updateSpy).toHaveBeenCalledWith(uid, { role: "member" });
      expect(req.user.role).toBe("member");
      expect(responsePayload).toBeDefined();
      expect(responsePayload.data.isMember).toBe(true);
      expect(responsePayload.data.role).toBe("member");
    });

    it("returns a populated uid object for non-members without a Member document so MyProfile does not spin infinitely", async () => {
      const uid = new Types.ObjectId();

      jest.spyOn(Member, "findOne").mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      } as any);

      const req: any = {
        user: {
          _id: uid,
          name: "New App User",
          email: "newuser@example.com",
          phoneNumber: "01112223334",
          role: "user",
        },
      };
      let responsePayload: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((body) => {
          responsePayload = body;
        }),
      };

      await getMemberProfile(req, res, jest.fn());

      expect(responsePayload).toBeDefined();
      expect(responsePayload.data.isMember).toBe(false);
      expect(responsePayload.data.pendingApproval).toBe(true);
      expect(responsePayload.data.role).toBe("user");
      expect(responsePayload.data.uid).toEqual({
        _id: uid,
        id: uid,
        name: "New App User",
        email: "newuser@example.com",
        phoneNumber: "01112223334",
        role: "user",
      });
    });
  });

  describe("2. Package Booking Error Priority & Chronological Ordering (Maisa Ghaly & Afaf Afifi Scenarios)", () => {
    const uid = new Types.ObjectId().toString();
    const scid = new Types.ObjectId().toString();
    const cid = new Types.ObjectId().toString();
    const studioPkg5Id = new Types.ObjectId();
    const studioPkg10Id = new Types.ObjectId();
    const studioPkg15Id = new Types.ObjectId();
    const validPkgs = [
      studioPkg5Id.toString(),
      studioPkg10Id.toString(),
      studioPkg15Id.toString(),
    ];

    it("throws NO_REMAINING_SESSIONS (not PACKAGE_EXPIRED from an old May package) when current package is COMPLETED inside its valid date window (Maisa Ghaly scenario)", async () => {
      const futureEnd = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000); // e.g. Oct 7, 2026
      const recentStart = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000); // e.g. Sep 7, 2026

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          // Index 0: Old expired package from May 2026
          {
            pkgId: studioPkg5Id,
            name: "5 Studio",
            remainingClasses: 0,
            pkgStartDate: new Date("2026-04-30T00:00:00.000Z"),
            pkgEndDate: new Date("2026-05-30T00:00:00.000Z"),
            status: "EXPIRED",
          },
          // Index 1: Current package (Sep 7 – Oct 7) with 0 remaining sessions (COMPLETED)
          {
            pkgId: studioPkg5Id,
            name: "5 Studio",
            remainingClasses: 0,
            pkgStartDate: recentStart,
            pkgEndDate: futureEnd,
            status: "COMPLETED",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      let caughtError: any = null;
      try {
        await Member.saveBooking(
          uid,
          validPkgs,
          scid,
          false,
          false,
          cid,
          "92026",
          1,
          {} as any,
          "50 & Fab",
          new Date(),
          "member"
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ForbiddenError);
      expect(caughtError.code).toBe("NO_REMAINING_SESSIONS");
      expect(caughtError.message).toBe(
        'Your package "5 Studio" covering "50 & Fab" has 0 remaining sessions.'
      );
    });

    it("throws PACKAGE_EXPIRED referencing the MOST RECENT expired package instead of the oldest historical one (Afaf Afifi / Foufa scenario)", async () => {
      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          // Index 0: Older expired 10 Studio package from June 30, 2026
          {
            pkgId: studioPkg10Id,
            name: "10 Studio",
            remainingClasses: 0,
            pkgStartDate: new Date("2026-05-01T12:00:00.000Z"),
            pkgEndDate: new Date("2026-06-30T12:00:00.000Z"),
            status: "EXPIRED",
          },
          // Index 1: Newer 15 Studio package (12 sessions left) that expired on Sep 25, 2026
          {
            pkgId: studioPkg15Id,
            name: "15 Studio",
            remainingClasses: 12,
            pkgStartDate: new Date("2026-07-12T12:00:00.000Z"),
            pkgEndDate: new Date("2026-09-25T12:00:00.000Z"),
            status: "EXPIRED",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      let caughtError: any = null;
      try {
        await Member.saveBooking(
          uid,
          validPkgs,
          scid,
          false,
          false,
          cid,
          "92026",
          1,
          {} as any,
          "50 & Fab",
          new Date(),
          "member"
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ForbiddenError);
      expect(caughtError.code).toBe("PACKAGE_EXPIRED");
      expect(caughtError.context.packageName).toBe("15 Studio");
      expect(caughtError.message).toContain('"15 Studio"');
      expect(caughtError.message).toContain("2026");
      expect(caughtError.message).not.toContain('"10 Studio"');
    });

    it("ignores DELETED packages when resolving booking failure reasons", async () => {
      const futureEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          // Deleted package that would otherwise look like a future/completed package
          {
            pkgId: studioPkg10Id,
            name: "10 Studio",
            remainingClasses: 0,
            pkgStartDate: new Date("2026-09-01T12:00:00.000Z"),
            pkgEndDate: futureEnd,
            status: "DELETED",
          },
          // Actual expired package on account
          {
            pkgId: studioPkg15Id,
            name: "15 Studio",
            remainingClasses: 4,
            pkgStartDate: new Date("2026-07-01T12:00:00.000Z"),
            pkgEndDate: new Date("2026-09-20T12:00:00.000Z"),
            status: "EXPIRED",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      let caughtError: any = null;
      try {
        await Member.saveBooking(
          uid,
          validPkgs,
          scid,
          false,
          false,
          cid,
          "92026",
          1,
          {} as any,
          "50 & Fab",
          new Date(),
          "member"
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ForbiddenError);
      expect(caughtError.code).toBe("PACKAGE_EXPIRED");
      expect(caughtError.context.packageName).toBe("15 Studio");
    });

    it("reports NO_PACKAGES_ON_ACCOUNT if the only packages on the member record have status DELETED", async () => {
      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          {
            pkgId: studioPkg10Id,
            name: "10 Studio",
            remainingClasses: 5,
            pkgStartDate: new Date("2026-09-01T12:00:00.000Z"),
            pkgEndDate: new Date("2026-10-01T12:00:00.000Z"),
            status: "DELETED",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      let caughtError: any = null;
      try {
        await Member.saveBooking(
          uid,
          validPkgs,
          scid,
          false,
          false,
          cid,
          "92026",
          1,
          {} as any,
          "50 & Fab",
          new Date(),
          "member"
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ForbiddenError);
      expect(caughtError.code).toBe("NO_PACKAGES_ON_ACCOUNT");
    });
  });

  // =========================================================================
  // 3. App Version Detection, Update Reminders & Force-Update Enforcement
  // =========================================================================
  describe("3. App Version Detection, Update Reminders & Force-Update Enforcement", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      jest.restoreAllMocks();
    });

    it("compares semantic versions accurately (including build metadata)", () => {
      expect(compareSemver("1.0.10", "1.0.11")).toBe(-1);
      expect(compareSemver("1.0.11+11", "1.0.11")).toBe(0);
      expect(compareSemver("1.0.12", "1.0.11")).toBe(1);
      expect(compareSemver("1.0.9", "1.0.10")).toBe(-1);
    });

    it("allows requests without x-app-version (a2b0e9f / 1.0.10) by default while marking them for update reminders", async () => {
      delete process.env.BLOCK_MISSING_APP_VERSION;
      const evaluation = evaluateAppVersion(undefined);
      expect(evaluation.isMissingVersion).toBe(true);
      expect(evaluation.forceUpdate).toBe(false);
      expect(evaluation.updateAvailable).toBe(true);
      expect(evaluation.iosStoreUrl).toBe(
        "https://apps.apple.com/eg/app/the-mind-space/id6738055505"
      );

      jest.spyOn(SchedulerService, "getSchedule").mockResolvedValue([
        {
          _id: "real_class_1",
          className: "50 & Fab",
          availableSlots: 5,
          locationId: { branchName: "Cairo Branch", location: "Cairo" },
        } as any,
      ]);

      const req: any = {
        method: "GET",
        path: "/schedule",
        headers: {},
        query: { date: "2026-09-28" },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      checkMobileAppVersion(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.isOutdatedMobileApp).toBe(true);
      expect(withUpdateReminder(req, "Class Booked!")).toContain(
        "Please update The Mind Space app"
      );

      await getSchedule(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toBe("Scheduled Classes Found!");
      expect(payload.data).toHaveLength(2);
      expect(payload.data[0]._id).toBe("app_update_reminder");
      expect(payload.data[0].cid.title).toContain("New App Update Available");
      expect(payload.data[1]._id).toBe("real_class_1");
    });

    it("does not prepend reminder banner or append reminder message when client sends latest x-app-version (1.0.12)", async () => {
      jest.spyOn(SchedulerService, "getSchedule").mockResolvedValue([
        {
          _id: "real_class_1",
          className: "50 & Fab",
          availableSlots: 5,
        } as any,
      ]);

      const req: any = {
        method: "GET",
        path: "/schedule",
        headers: { "x-app-version": "1.0.12" },
        query: { date: "2026-09-28" },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      checkMobileAppVersion(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.isOutdatedMobileApp).toBe(false);
      expect(withUpdateReminder(req, "Class Booked!")).toBe("Class Booked!");

      await getSchedule(req, res, jest.fn());
      const payload = res.json.mock.calls[0][0];
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]._id).toBe("real_class_1");
    });

    it("hard-blocks versions below minRequiredVersion (or missing version when BLOCK_MISSING_APP_VERSION=true)", async () => {
      // Case A: Client explicitly on 1.0.9 (< 1.0.10 minRequiredVersion)
      const reqOldVersion: any = {
        method: "POST",
        path: "/book/68d800000000000000000001",
        headers: { "x-app-version": "1.0.9" },
        query: {},
      };
      const resOldVersion: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const nextOldVersion = jest.fn();

      checkMobileAppVersion(reqOldVersion, resOldVersion, nextOldVersion);
      const errOld = nextOldVersion.mock.calls[0][0];
      expect(errOld).toBeDefined();
      expect(errOld.code).toBe("APP_UPDATE_REQUIRED");
      expect(errOld.message).toContain("Please update The Mind Space app");

      // Case B: Missing version when BLOCK_MISSING_APP_VERSION=true
      process.env.BLOCK_MISSING_APP_VERSION = "true";
      const reqScheduleBlocked: any = {
        method: "GET",
        path: "/schedule",
        headers: {},
        query: { date: "2026-09-28" },
      };
      const resScheduleBlocked: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const nextScheduleBlocked = jest.fn();

      checkMobileAppVersion(
        reqScheduleBlocked,
        resScheduleBlocked,
        nextScheduleBlocked
      );
      expect(nextScheduleBlocked).not.toHaveBeenCalled();
      expect(resScheduleBlocked.status).toHaveBeenCalledWith(200);
      const blockedPayload = resScheduleBlocked.json.mock.calls[0][0];
      expect(blockedPayload.message).toBe("Scheduled Classes Found!");
      expect(blockedPayload.data).toHaveLength(1);
      expect(blockedPayload.data[0]._id).toBe("app_update_required");
    });

    it("returns version metadata from GET /auth/app-version", async () => {
      const req: any = {
        headers: { "x-app-version": "1.0.10" },
        query: {},
        body: {},
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await getAppVersionInfo(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.latestVersion).toBe("1.0.12");
      expect(payload.data.minRequiredVersion).toBe("1.0.10");
      expect(payload.data.updateAvailable).toBe(true);
      expect(payload.data.forceUpdate).toBe(false);
    });
  });
});
