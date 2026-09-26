import { Types } from "mongoose";
import { BookingsService } from "./bookings-service";
import { SubscriptionsService } from "./subscriptions-service";
import { SchedulerService } from "./scheduler-service";
import { getSchedule } from "../controllers/client/class-controller";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import Package from "../models/package";
import Payment from "../models/payment";
import * as matchaBranch from "../utils/matcha-branch";
import * as appPackageLocation from "../utils/app-package-location";
import { PaymentsService } from "./payments-service";
import { runInTransaction } from "../utils/transaction";
import Reservation from "../models/reservation";
import WaitlistEntry from "../models/waitlistEntry";
import User from "../models/user";

jest.mock("../models/member");
jest.mock("../models/scheduledClass");
jest.mock("../models/package");
jest.mock("../models/promoCode");
jest.mock("../models/payment");
jest.mock("../models/reservation");
jest.mock("../models/waitlistEntry");
jest.mock("../models/user");
jest.mock("./payments-service");
jest.mock("./scheduler-service");
jest.mock("./egygap-erp-service", () => ({
  sendPaymentToRentalSystem: jest.fn(),
}));
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(),
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock("../utils/matcha-branch");
jest.mock("../utils/app-package-location");

describe("Non-Member Access: View Classes, Drop-ins Only, Packages Blocked", () => {
  const uid = new Types.ObjectId().toString();
  const scid = new Types.ObjectId().toString();
  const pkgId = new Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) => fn({}));
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(true);
    (matchaBranch.ensureMemberForPendingPurchase as jest.Mock).mockResolvedValue({});
  });

  describe("getSchedule controller", () => {
    it("returns all classes across branches without filtering out non-Matcha sessions", async () => {
      const mockClasses = [
        { _id: "sc1", sessionBranchName: "New Cairo", availableSlots: 5 },
        { _id: "sc2", sessionBranchName: "Matcha", availableSlots: 3 },
      ];
      (SchedulerService.getSchedule as jest.Mock).mockResolvedValue(mockClasses);

      const req: any = {
        query: { date: "2026-09-16" },
        user: { _id: uid, role: "user" },
      };
      let responseBody: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          responseBody = data;
        }),
      };

      await getSchedule(req, res, () => {});

      expect(responseBody).toBeDefined();
      expect(responseBody.data).toHaveLength(2);
      expect(responseBody.data[0].sessionBranchName).toBe("New Cairo");
      expect(responseBody.data[1].sessionBranchName).toBe("Matcha");
    });
  });

  describe("BookingsService.bookDropIn", () => {
    it("allows non-member to book drop-in for a class at any branch without Matcha restriction", async () => {
      const scheduledClass = {
        _id: new Types.ObjectId(scid),
        availableSlots: 10,
        bookedMembers: [],
        cid: {
          category: "STUDIO",
          allowDropIn: true,
          price: 400,
        },
        startTime: new Date(Date.now() + 86400000),
        endTime: new Date(Date.now() + 90000000),
        locationId: { branchName: "New Cairo" },
      };

      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(scheduledClass),
      });
      (Member.findOne as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        uid,
        bookings: [],
      });
      (Reservation.countDocuments as jest.Mock).mockResolvedValue(0);
      (Reservation.findOne as jest.Mock).mockResolvedValue(null);
      (WaitlistEntry.findOne as jest.Mock).mockResolvedValue(null);
      (appPackageLocation.resolveSessionPaymentLocationId as jest.Mock).mockResolvedValue("loc-cairo");
      (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue(null);
      (PaymentsService.savePayment as jest.Mock).mockResolvedValue({ _id: new Types.ObjectId() });
      (Member.saveDropIn as jest.Mock).mockResolvedValue(undefined);
      (ScheduledClass.bookMember as jest.Mock).mockResolvedValue(undefined);
      (Payment.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await expect(
        BookingsService.bookDropIn(uid, scid, "ref-test-123"),
      ).resolves.not.toThrow();

      expect(Member.saveDropIn).toHaveBeenCalled();
    });
  });

  describe("Package and regular class booking restrictions", () => {
    it("blocks non-members from booking package classes via addBooking", async () => {
      const scheduledClass = {
        _id: new Types.ObjectId(scid),
        availableSlots: 10,
        bookedMembers: [],
        cid: {
          category: "STUDIO",
          price: 400,
        },
        startTime: new Date(Date.now() + 86400000),
        endTime: new Date(Date.now() + 90000000),
      };

      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(scheduledClass),
        }),
      });

      await expect(
        BookingsService.addBooking(uid, scid),
      ).rejects.toThrow("Booking classes with packages requires membership");
    });

    it("blocks non-members from purchasing packages via subscribeToPackage", async () => {
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "10 Class Pass",
        isDeprecated: false,
        price: 3000,
      });

      await expect(
        SubscriptionsService.subscribeToPackage(
          uid,
          pkgId,
          new Date().toISOString(),
          "APP",
          "ref-pkg-123",
        ),
      ).rejects.toThrow("Packages require membership");
    });
  });

  describe("getMemberProfile controller: membership role resolution", () => {
    it("returns isMember: false and role: 'user' when non-member has no Member record", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "user" },
      };
      let result: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          result = data;
        }),
      };

      const { getMemberProfile } = await import("../controllers/client/member-controller");
      await getMemberProfile(req, res, () => {});

      expect(result).toBeDefined();
      expect(result.data.isMember).toBe(false);
      expect(result.data.role).toBe("user");
      expect(result.data.pendingApproval).toBe(true);
    });

    it("returns isMember: false even if non-member has Member record from previous drop-in", async () => {
      const mockMemberDoc = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [],
        toObject: () => ({ uid, bookings: [], packages: [] }),
      };

      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockMemberDoc),
        }),
      });
      (Member.populate as jest.Mock).mockResolvedValue(mockMemberDoc);

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "user" },
      };
      let result: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          result = data;
        }),
      };

      const { getMemberProfile } = await import("../controllers/client/member-controller");
      await getMemberProfile(req, res, () => {});

      expect(result).toBeDefined();
      expect(result.data.isMember).toBe(false);
      expect(result.data.role).toBe("user");
    });

    it("returns isMember: true and role: 'member' for approved members", async () => {
      const mockMemberDoc = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [],
        toObject: () => ({ uid, bookings: [], packages: [] }),
      };

      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockMemberDoc),
        }),
      });
      (Member.populate as jest.Mock).mockResolvedValue(mockMemberDoc);

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "member" },
      };
      let result: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          result = data;
        }),
      };

      const { getMemberProfile } = await import("../controllers/client/member-controller");
      await getMemberProfile(req, res, () => {});

      expect(result).toBeDefined();
      expect(result.data.isMember).toBe(true);
      expect(result.data.role).toBe("member");
    });

    it("returns isMember: true and promotes role: 'member' when user with role 'user' has active packages", async () => {
      const mockMemberDoc = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          {
            pkgId: new Types.ObjectId(),
            status: "ACTIVE",
            remainingClasses: 5,
          },
        ],
        toObject: () => ({
          uid,
          bookings: [],
          packages: [
            {
              pkgId: new Types.ObjectId(),
              status: "ACTIVE",
              remainingClasses: 5,
            },
          ],
        }),
      };

      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockMemberDoc),
        }),
      });
      (Member.populate as jest.Mock).mockResolvedValue(mockMemberDoc);
      (User.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "user" },
      };
      let result: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          result = data;
        }),
      };

      const { getMemberProfile } = await import("../controllers/client/member-controller");
      await getMemberProfile(req, res, () => {});

      expect(result).toBeDefined();
      expect(result.data.isMember).toBe(true);
      expect(result.data.role).toBe("member");
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { role: "member" },
      );
    });

    it("lazily creates Member doc and returns isMember: true when member has no doc", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const mockSavedDoc = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [],
        save: jest.fn().mockResolvedValue(undefined),
        populate: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ uid, bookings: [], packages: [] }),
      };
      (Member as any).mockImplementation?.(() => mockSavedDoc);

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "member" },
      };
      let result: any = null;
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn((data) => {
          result = data;
        }),
      };

      const { getMemberProfile } = await import("../controllers/client/member-controller");
      await getMemberProfile(req, res, () => {});

      expect(result).toBeDefined();
      expect(result.data.isMember).toBe(true);
      expect(result.data.role).toBe("member");
    });
  });

  describe("Route authorization middleware: packages route gating", () => {
    it("rejects user with role 'user' from accessing member-only routes", async () => {
      const { authorizeUser } = await import("../middlewares/auth.middleware");
      const middleware = authorizeUser(["member"]);

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "user" },
      };
      const res: any = {};
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        message: "Access denied - Insufficient permissions",
      }));
    });

    it("allows user with role 'member' to access member-only routes", async () => {
      const { authorizeUser } = await import("../middlewares/auth.middleware");
      const middleware = authorizeUser(["member"]);

      const req: any = {
        user: { _id: new Types.ObjectId(uid), role: "member" },
      };
      const res: any = {};
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
