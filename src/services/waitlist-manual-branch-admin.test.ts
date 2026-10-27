import { Types, ClientSession } from "mongoose";
import { WaitlistService } from "./waitlist-service";
import { BookingsService } from "./bookings-service";
import ScheduledClass from "../models/scheduledClass";
import WaitlistEntry from "../models/waitlistEntry";
import Reservation from "../models/reservation";
import User from "../models/user";
import Package from "../models/package";
import Member from "../models/member";
import { NotificationsService } from "./notifications-service";
import { getIO } from "../config/socket";

jest.mock("../models/scheduledClass");
jest.mock("../models/waitlistEntry");
jest.mock("../models/reservation");
jest.mock("../models/user");
jest.mock("../models/package");
jest.mock("../models/member");
jest.mock("./notifications-service");
jest.mock("../config/socket");

const mockSession = {} as ClientSession;
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(async (fn) => fn(mockSession)),
}));

jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("Waitlist Manual Entry & Branch Admin Notification", () => {
  let mockSocketEmit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocketEmit = jest.fn();
    (getIO as jest.Mock).mockReturnValue({
      emit: mockSocketEmit,
    });
  });

  describe("checkMemberPackageEligibility", () => {
    it("returns true when member has an active package that opens the class with remaining sessions", async () => {
      const userId = new Types.ObjectId();
      const classId = new Types.ObjectId();
      const pkgId = new Types.ObjectId();

      (Package.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: pkgId }]),
        }),
      });

      (Member.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uid: userId,
          packages: [
            {
              pkgId,
              name: "Studio 10 Sessions",
              status: "ACTIVE",
              pkgStartDate: new Date("2026-01-01"),
              pkgEndDate: new Date("2026-12-31"),
              remainingClasses: 5,
            },
          ],
        }),
      });

      const isEligible = await WaitlistService.checkMemberPackageEligibility(
        userId,
        classId,
        new Date("2026-10-27T10:00:00Z")
      );

      expect(isEligible).toBe(true);
    });

    it("returns false when member has no packages or 0 remaining sessions", async () => {
      const userId = new Types.ObjectId();
      const classId = new Types.ObjectId();
      const pkgId = new Types.ObjectId();

      (Package.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: pkgId }]),
        }),
      });

      (Member.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          uid: userId,
          packages: [
            {
              pkgId,
              name: "Studio 10 Sessions",
              status: "ACTIVE",
              pkgStartDate: new Date("2026-01-01"),
              pkgEndDate: new Date("2026-12-31"),
              remainingClasses: 0,
            },
          ],
        }),
      });

      const isEligible = await WaitlistService.checkMemberPackageEligibility(
        userId,
        classId,
        new Date("2026-10-27T10:00:00Z")
      );

      expect(isEligible).toBe(false);
    });
  });

  describe("processWaitlist with manual entry and dynamic timeframe", () => {
    it("notifies branch admins with dynamic window when manual member has NO eligible package", async () => {
      const scid = new Types.ObjectId().toString();
      const locationId = new Types.ObjectId();
      const classId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const branchAdminId = new Types.ObjectId();

      // Class starts in 4 hours -> remainingTime = 4 * 3600 * 1000 = 14,400,000 ms <= 6h
      // dynamicWindow = clamp(4h * 0.15, 10m, 45m) = 36 minutes
      const classStartTime = new Date(Date.now() + 4 * 60 * 60 * 1000);

      const mockScheduledClass = {
        _id: new Types.ObjectId(scid),
        cid: { _id: classId, title: "Mat Pilates" },
        locationId,
        availableSlots: 1,
        startTime: classStartTime,
      };

      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockScheduledClass),
      });

      (Reservation.findOne as jest.Mock).mockResolvedValue(null);

      const mockSelectedEntry = {
        sessionId: new Types.ObjectId(scid),
        userId,
        isManual: true,
        status: "WAITING",
        position: 1,
        save: jest.fn().mockResolvedValue(undefined),
      };

      (WaitlistEntry.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockResolvedValue([mockSelectedEntry]),
      });

      // Member has no active package
      jest.spyOn(WaitlistService, "checkMemberPackageEligibility").mockResolvedValue(false);

      const mockUser = {
        _id: userId,
        name: "Noura Ashraf",
        phoneNumber: "01012442999",
        fcmTokens: ["member-token"],
      };
      (User.findById as jest.Mock).mockResolvedValue(mockUser);

      (User.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: branchAdminId }]),
      });

      await WaitlistService.processWaitlist(scid);

      // Verify member received notification
      expect(NotificationsService.notifyWaitlistUser).toHaveBeenCalledWith(
        userId.toString(),
        ["member-token"],
        "Mat Pilates",
        classStartTime.getDay(),
        expect.any(Date)
      );

      // Verify branch admins received push notification with dynamic window (~36 minutes)
      expect(NotificationsService.notifyUsers).toHaveBeenCalledWith(
        [branchAdminId.toString()],
        "⚠️ Waitlist Action: Contact Member",
        expect.stringContaining("has NO active package! You have 36 mins to contact them"),
        expect.objectContaining({
          type: "WAITLIST_MANUAL_NO_PACKAGE",
          scid,
          userId: userId.toString(),
          memberName: "Noura Ashraf",
          windowMinutes: "36",
        })
      );

      // Verify socket event was emitted
      expect(mockSocketEmit).toHaveBeenCalledWith(
        "waitlist:manual_action_required",
        expect.objectContaining({
          scid,
          locationId: locationId.toString(),
          userId: userId.toString(),
          memberName: "Noura Ashraf",
          windowMinutes: 36,
        })
      );
    });

    it("does NOT alert branch admin if manual member DOES have an eligible active package", async () => {
      const scid = new Types.ObjectId().toString();
      const locationId = new Types.ObjectId();
      const classId = new Types.ObjectId();
      const userId = new Types.ObjectId();

      const classStartTime = new Date(Date.now() + 4 * 60 * 60 * 1000);

      const mockScheduledClass = {
        _id: new Types.ObjectId(scid),
        cid: { _id: classId, title: "Mat Pilates" },
        locationId,
        availableSlots: 1,
        startTime: classStartTime,
      };

      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockScheduledClass),
      });

      (Reservation.findOne as jest.Mock).mockResolvedValue(null);

      const mockSelectedEntry = {
        sessionId: new Types.ObjectId(scid),
        userId,
        isManual: true,
        status: "WAITING",
        position: 1,
        save: jest.fn().mockResolvedValue(undefined),
      };

      (WaitlistEntry.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockResolvedValue([mockSelectedEntry]),
      });

      // Member HAS an eligible active package!
      jest.spyOn(WaitlistService, "checkMemberPackageEligibility").mockResolvedValue(true);

      const mockUser = {
        _id: userId,
        name: "Sara Ahmed",
        phoneNumber: "01099999999",
        fcmTokens: ["member-token"],
      };
      (User.findById as jest.Mock).mockResolvedValue(mockUser);

      await WaitlistService.processWaitlist(scid);

      // Verify member received notification
      expect(NotificationsService.notifyWaitlistUser).toHaveBeenCalled();

      // Branch admin alert must NOT be called
      expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
      expect(mockSocketEmit).not.toHaveBeenCalled();
    });
  });

  describe("adminRemoveFromWaitlist", () => {
    it("cancels active reservation and immediately promotes next waitlist member when notified member is removed", async () => {
      const scid = new Types.ObjectId().toString();
      const uid = new Types.ObjectId().toString();

      (ScheduledClass.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(scid),
        waitlistedMembers: [],
      });

      const mockWaitlistEntry = {
        sessionId: new Types.ObjectId(scid),
        userId: new Types.ObjectId(uid),
        status: "NOTIFIED",
        save: jest.fn().mockResolvedValue(undefined),
      };

      (WaitlistEntry.findOne as jest.Mock).mockResolvedValue(mockWaitlistEntry);
      (Reservation.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const processWaitlistSpy = jest
        .spyOn(WaitlistService, "processWaitlist")
        .mockResolvedValue(undefined);

      await BookingsService.adminRemoveFromWaitlist(uid, scid);

      expect(mockWaitlistEntry.status).toBe("CANCELLED");
      expect(mockWaitlistEntry.save).toHaveBeenCalled();
      expect(Reservation.updateMany).toHaveBeenCalledWith(
        {
          sessionId: new Types.ObjectId(scid),
          userId: new Types.ObjectId(uid),
          status: "ACTIVE",
        },
        { status: "CANCELLED" }
      );
      expect(processWaitlistSpy).toHaveBeenCalledWith(scid);
    });
  });
});
