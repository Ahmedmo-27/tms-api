import { Types } from "mongoose";
import { CoachService } from "../services/coach-service";
import User from "../models/user";
import Coach from "../models/coach";
import Member from "../models/member";
import Package from "../models/package";
import ScheduledClass from "../models/scheduledClass";
import Class from "../models/class";
import DailyAttendance from "../models/dailyAttendance";
import CoachNotification from "../models/coachNotification";
import Ticket from "../models/ticket";
import DeductionLog from "../models/deductionLog";
import Location from "../models/location";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../core/ApiError";

jest.mock("../models/user");
jest.mock("../models/coach");
jest.mock("../models/member");
jest.mock("../models/package");
jest.mock("../models/scheduledClass");
jest.mock("../models/class");
jest.mock("../models/dailyAttendance");
jest.mock("../models/coachNotification");
jest.mock("../models/ticket");
jest.mock("../models/deductionLog");
jest.mock("../models/location");
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn().mockImplementation(async (callback) => {
    return callback(null);
  }),
}));

describe("Coach Dashboard & Service Performance", () => {
  const coachUserId = new Types.ObjectId();
  const coachDocId = new Types.ObjectId();
  const memberUid = new Types.ObjectId();
  const pkgId = new Types.ObjectId();
  const classId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getMe", () => {
    it("returns coach profile with branch and capability flags", async () => {
      const locationId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({
          name: "Coach John",
          email: "john@mindspace.com",
          phoneNumber: "01011112222",
          locationId,
        }),
      });
      (Location.findById as jest.Mock).mockResolvedValue({
        branchName: "Main Branch",
        location: "Downtown",
      });
      // Coach mocks for getCoachLookupIds (called inside getMe)
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        userId: coachUserId,
        coachName: "Coach John",
        phoneNumber: "01011112222",
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });
      (Package.countDocuments as jest.Mock).mockResolvedValue(3);
      (ScheduledClass.countDocuments as jest.Mock).mockResolvedValue(5);

      const profile = await CoachService.getMe(coachUserId, coachDocId);

      expect(profile).toEqual({
        name: "Coach John",
        email: "john@mindspace.com",
        phoneNumber: "01011112222",
        role: undefined,
        branchName: "Main Branch",
        branchLocation: "Downtown",
        hasPtSessions: true,
        hasScheduledClasses: true,
        scansCategories: [],
        canViewPtReports: false,
      });
    });
  });

  describe("getClients", () => {
    it("fetches PT clients, formats active PT info, and handles search & status filters", async () => {
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
      ]);

      const mockMember = {
        _id: new Types.ObjectId(),
        uid: {
          _id: memberUid,
          name: "Alice Smith",
          email: "alice@example.com",
          phoneNumber: "01099998888",
        },
        packages: [
          {
            pkgId,
            status: "ACTIVE",
            remainingClasses: 1,
            pkgStartDate: new Date(),
            pkgEndDate: new Date(Date.now() + 5 * 86400000), // 5 days left
          },
        ],
      };

      (Member.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([mockMember]),
      });

      const res = await CoachService.getClients(coachDocId, {
        status: "active",
        alert: "low",
        search: "Alice",
      });

      expect(res.total).toBe(1);
      expect(res.clients[0].name).toBe("Alice Smith");
      expect(res.clients[0].remainingClasses).toBe(1);
      expect(res.clients[0].daysUntilExpiry).toBeLessThanOrEqual(5);
    });

    it("returns all subscribers across multiple PT packages of the coach and aggregates multiple packages for the same subscriber", async () => {
      const ptPkg1 = new Types.ObjectId();
      const ptPkg2 = new Types.ObjectId();
      const otherCoachPkg = new Types.ObjectId();
      const member1Uid = new Types.ObjectId();
      const member2Uid = new Types.ObjectId();
      const member3Uid = new Types.ObjectId();

      // Coach has 2 PT packages
      (Package.find as jest.Mock)
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
        ])
        // packagesInfo lookup for all package IDs
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: otherCoachPkg, name: "Other PT", category: "PERSONAL_TRAINING", coachId: new Types.ObjectId() },
        ]);

      const now = Date.now();
      const mockMembers = [
        // Member 1 subscribed to PT Pkg 1
        {
          _id: new Types.ObjectId(),
          uid: { _id: member1Uid, name: "Bob Client", email: "bob@test.com", phoneNumber: "01011110001" },
          packages: [
            { pkgId: ptPkg1, status: "ACTIVE", remainingClasses: 5, pkgStartDate: new Date(now), pkgEndDate: new Date(now + 30 * 86400000) },
          ],
        },
        // Member 2 subscribed to BOTH PT Pkg 1 and PT Pkg 2
        {
          _id: new Types.ObjectId(),
          uid: { _id: member2Uid, name: "Charlie Client", email: "charlie@test.com", phoneNumber: "01011110002" },
          packages: [
            { pkgId: ptPkg1, status: "ACTIVE", remainingClasses: 2, pkgStartDate: new Date(now), pkgEndDate: new Date(now + 10 * 86400000) },
            { pkgId: ptPkg2, status: "ACTIVE", remainingClasses: 8, pkgStartDate: new Date(now), pkgEndDate: new Date(now + 60 * 86400000) },
          ],
        },
        // Member 3 is a past subscriber (expired package, 0 remaining)
        {
          _id: new Types.ObjectId(),
          uid: { _id: member3Uid, name: "David Past", email: "david@test.com", phoneNumber: "01011110003" },
          packages: [
            { pkgId: ptPkg1, status: "EXPIRED", remainingClasses: 0, pkgStartDate: new Date(now - 60 * 86400000), pkgEndDate: new Date(now - 10 * 86400000) },
          ],
        },
      ];

      (Member.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockMembers),
      });

      // 1. Active subscribers
      const activeRes = await CoachService.getClients(coachDocId, { status: "active" });
      expect(activeRes.total).toBe(2);
      expect(activeRes.clients.map(c => c.name)).toEqual(["Bob Client", "Charlie Client"]);
      
      // Charlie has 2 active packages, lowest remainingClasses is 2
      const charlie = activeRes.clients.find(c => c.name === "Charlie Client");
      expect(charlie?.activePackagesCount).toBe(2);
      expect(charlie?.remainingClasses).toBe(2);

      // 2. Past subscribers
      (Package.find as jest.Mock)
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
        ])
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
        ]);
      const pastRes = await CoachService.getClients(coachDocId, { status: "past" });
      expect(pastRes.total).toBe(1);
      expect(pastRes.clients[0].name).toBe("David Past");

      // 3. All subscribers (active + past)
      (Package.find as jest.Mock)
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
        ])
        .mockResolvedValueOnce([
          { _id: ptPkg1, name: "PT 10 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
          { _id: ptPkg2, name: "PT 20 Sessions", category: "PERSONAL_TRAINING", coachId: coachDocId },
        ]);
      const allRes = await CoachService.getClients(coachDocId, { status: "all" });
      expect(allRes.total).toBe(3);
    });

    it("returns empty result when coach has no assigned PT packages", async () => {
      (Package.find as jest.Mock).mockResolvedValue([]);
      (Member.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });

      const res = await CoachService.getClients(coachDocId, { status: "active" });
      expect(res.total).toBe(0);
      expect(res.clients).toEqual([]);
      expect(res.totalPages).toBe(1);
    });
  });

  describe("getMemberPackages", () => {
    it("throws NotFoundError if member not found", async () => {
      (Member.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        CoachService.getMemberPackages(coachDocId, memberUid.toString())
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError if coach has no link to member", async () => {
      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [{ pkgId, status: "ACTIVE", remainingClasses: 5, pkgStartDate: new Date(), pkgEndDate: new Date() }],
      });
      (ScheduledClass.findOne as jest.Mock).mockResolvedValue(null);
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, coachId: new Types.ObjectId(), category: "PERSONAL_TRAINING" }, // different coach
      ]);

      await expect(
        CoachService.getMemberPackages(coachDocId, memberUid.toString())
      ).rejects.toThrow(ForbiddenError);
    });

    it("returns member packages when linked via personal training package", async () => {
      const now = new Date();
      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [
          {
            pkgId,
            name: "PT 10 Sessions",
            status: "ACTIVE",
            remainingClasses: 4,
            pkgStartDate: now,
            pkgEndDate: new Date(now.getTime() + 10 * 86400000),
          },
        ],
      });
      (ScheduledClass.findOne as jest.Mock).mockResolvedValue(null);
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "PT 10 Sessions", coachId: coachDocId, category: "PERSONAL_TRAINING", numberOfSessions: 10 },
      ]);
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ name: "Alice", phoneNumber: "01099998888" }),
      });

      const packages = await CoachService.getMemberPackages(coachDocId, memberUid.toString());
      expect(packages.length).toBe(1);
      expect(packages[0].isPtPackage).toBe(true);
      expect(packages[0].remainingClasses).toBe(4);
      expect(packages[0].totalClasses).toBe(10);
    });
  });

  describe("deductSession", () => {
    it("validates missing fields and date formats", async () => {
      await expect(
        CoachService.deductSession(coachDocId, {} as any)
      ).rejects.toThrow(BadRequestError);

      await expect(
        CoachService.deductSession(coachDocId, {
          memberId: memberUid.toString(),
          memberPackageStartDate: "invalid-date",
          reason: "Completed 1 on 1 session",
          sessionDate: "2026-09-15T12:00:00.000Z",
        })
      ).rejects.toThrow(BadRequestError);
    });

    it("deducts session atomically and creates deduction log", async () => {
      const startDate = new Date("2026-09-01T10:00:00.000Z");
      const mockPkg = {
        pkgId,
        status: "ACTIVE",
        remainingClasses: 5,
        pkgStartDate: startDate,
        pkgEndDate: new Date("2026-10-01T10:00:00.000Z"),
        toObject: () => ({
          pkgId,
          status: "ACTIVE",
          remainingClasses: 5,
          pkgStartDate: startDate,
          pkgEndDate: new Date("2026-10-01T10:00:00.000Z"),
        }),
      };

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [mockPkg],
      });
      (ScheduledClass.findOne as jest.Mock).mockResolvedValue(null);
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, category: "PERSONAL_TRAINING", coachId: coachDocId },
      ]);
      (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const saveMock = jest.fn().mockResolvedValue(true);
      (DeductionLog as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await CoachService.deductSession(coachDocId, {
        memberId: memberUid.toString(),
        memberPackageStartDate: startDate.toISOString(),
        reason: "Full body workout",
        sessionDate: new Date().toISOString(),
      });

      expect(res.remainingClasses).toBe(4);
      expect(Member.updateOne).toHaveBeenCalledWith(
        { uid: memberUid },
        expect.objectContaining({
          $inc: { "packages.$[pkg].remainingClasses": -1 },
        }),
        expect.objectContaining({
          arrayFilters: [
            {
              "pkg.pkgId": pkgId,
              "pkg.pkgStartDate": startDate,
            },
          ],
        })
      );
      expect(DailyAttendance.recordPtAttendance).not.toHaveBeenCalled();
    });

    it("records PT attendance and emits SUCCESS-SCAN when reason starts with Completed session", async () => {
      const startDate = new Date("2026-09-01T10:00:00.000Z");
      const mockPkg = {
        pkgId,
        status: "ACTIVE",
        remainingClasses: 5,
        pkgStartDate: startDate,
        pkgEndDate: new Date("2026-10-01T10:00:00.000Z"),
        toObject: () => ({
          pkgId,
          status: "ACTIVE",
          remainingClasses: 5,
          pkgStartDate: startDate,
          pkgEndDate: new Date("2026-10-01T10:00:00.000Z"),
        }),
      };

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [mockPkg],
      });
      (ScheduledClass.findOne as jest.Mock).mockResolvedValue(null);
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "10 PT with Coach", category: "PERSONAL_TRAINING", coachId: coachDocId },
      ]);
      (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const saveMock = jest.fn().mockResolvedValue(true);
      (DeductionLog as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const ioMock = { emit: jest.fn() };
      const sessionDate = "2026-09-23T12:00:00.000Z";

      const res = await CoachService.deductSession(
        coachDocId,
        {
          memberId: memberUid.toString(),
          memberPackageStartDate: startDate.toISOString(),
          reason: "Completed session. Great workout",
          sessionDate,
        },
        ioMock
      );

      expect(res.remainingClasses).toBe(4);
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        memberUid.toString(),
        "10 PT with Coach",
        null,
        "SUCCESS",
        ioMock,
        undefined,
        coachDocId.toString(),
        new Date(sessionDate)
      );
      expect(ioMock.emit).toHaveBeenCalledWith("SUCCESS-SCAN", expect.objectContaining({
        code: "PT_CLASS_ATTENDED",
        memberId: memberUid.toString(),
      }));
    });

    it("disambiguates when multiple packages share the same start date and matches by pkgId", async () => {
      const startDate = new Date("2026-09-15T12:00:00.000Z");
      const otherPkgId = new Types.ObjectId();
      const otherCoachId = new Types.ObjectId();

      const deletedPkg = {
        pkgId: otherPkgId,
        status: "DELETED",
        remainingClasses: 11,
        pkgStartDate: startDate,
        pkgEndDate: new Date("2026-10-27T12:00:00.000Z"),
        toObject: () => ({
          pkgId: otherPkgId,
          status: "DELETED",
          remainingClasses: 11,
          pkgStartDate: startDate,
          pkgEndDate: new Date("2026-10-27T12:00:00.000Z"),
        }),
      };

      const activePkg = {
        pkgId,
        status: "ACTIVE",
        remainingClasses: 9,
        pkgStartDate: startDate,
        pkgEndDate: new Date("2026-10-27T12:00:00.000Z"),
        toObject: () => ({
          pkgId,
          status: "ACTIVE",
          remainingClasses: 9,
          pkgStartDate: startDate,
          pkgEndDate: new Date("2026-10-27T12:00:00.000Z"),
        }),
      };

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [deletedPkg, activePkg],
      });
      (ScheduledClass.findOne as jest.Mock).mockResolvedValue(null);
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: otherPkgId, category: "PERSONAL_TRAINING", coachId: otherCoachId },
        { _id: pkgId, category: "PERSONAL_TRAINING", coachId: coachDocId },
      ]);
      (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const saveMock = jest.fn().mockResolvedValue(true);
      (DeductionLog as unknown as jest.Mock).mockImplementation(function (this: any, data: any) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      // Test 1: Explicit pkgId provided
      const resWithPkgId = await CoachService.deductSession(coachDocId, {
        memberId: memberUid.toString(),
        pkgId: pkgId.toString(),
        memberPackageStartDate: startDate.toISOString(),
        reason: "No-show session",
        sessionDate: new Date().toISOString(),
      });

      expect(resWithPkgId.remainingClasses).toBe(8);
      expect(resWithPkgId.pkgId).toBe(pkgId.toString());

      // Test 2: Fallback without pkgId also resolves to the active package for this coach
      const resWithoutPkgId = await CoachService.deductSession(coachDocId, {
        memberId: memberUid.toString(),
        memberPackageStartDate: startDate.toISOString(),
        reason: "No-show session",
        sessionDate: new Date().toISOString(),
      });

      expect(resWithoutPkgId.remainingClasses).toBe(8);
      expect(resWithoutPkgId.pkgId).toBe(pkgId.toString());
    });
  });

  describe("getSchedule Performance & Batching", () => {
    it("executes batch queries instead of N+1 queries across scheduled classes and members", async () => {
      const scheduledClassId = new Types.ObjectId();
      const mockScheduledClasses = [
        {
          _id: scheduledClassId,
          cid: classId,
          coachId: [coachDocId],
          startTime: new Date("2026-09-15T08:00:00.000Z"),
          endTime: new Date("2026-09-15T09:00:00.000Z"),
          availableSlots: 10,
          bookedMembers: [
            { uid: memberUid, method: "Package" },
          ],
          locationId: { branchName: "Main Branch" },
        },
      ];

      // Coach mocks for getCoachLookupIds (called inside getSchedule)
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        userId: coachUserId,
        coachName: "Coach John",
        phoneNumber: "01011112222",
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      // ScheduledClass.find chains: .populate(locationId).populate(coachId).sort()
      const sortMock = jest.fn().mockResolvedValue(mockScheduledClasses);
      const populate2Mock = jest.fn().mockReturnValue({ sort: sortMock });
      const populate1Mock = jest.fn().mockReturnValue({ populate: populate2Mock });
      (ScheduledClass.find as jest.Mock).mockReturnValue({
        populate: populate1Mock,
      });

      (Class.find as jest.Mock).mockResolvedValue([
        { _id: classId, title: "HIIT Workout", category: "STUDIO" },
      ]);

      (Member.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([
          {
            uid: { _id: memberUid, name: "Alice Smith", phoneNumber: "01011112222" },
            packages: [
              { pkgId, status: "ACTIVE", remainingClasses: 8, pkgStartDate: new Date() },
            ],
          },
        ]),
      });

      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "Monthly Studio", coachId: null },
      ]);

      const weekStart = new Date("2026-09-15T00:00:00.000Z");
      const schedule = await CoachService.getSchedule(coachDocId, weekStart);

      expect(Class.find).toHaveBeenCalledWith({ _id: { $in: [classId.toString()] } });
      expect(Member.find).toHaveBeenCalledWith({ uid: { $in: [memberUid.toString()] } });
      expect(Package.find).toHaveBeenCalledWith({ _id: { $in: [pkgId.toString()] } });

      // Ensure NO single-record findById was called in loops
      expect(Class.findById).not.toHaveBeenCalled();
      expect(Member.findOne).not.toHaveBeenCalled();

      expect(schedule.days.length).toBe(7);
      const todaySession = schedule.days.flatMap((d) => d.sessions);
      expect(todaySession.length).toBe(1);
      expect(todaySession[0].classTitle).toBe("HIIT Workout");
      expect(todaySession[0].clients.length).toBe(1);
      expect(todaySession[0].clients[0].name).toBe("Alice Smith");
    });
  });

  describe("getToday Summary", () => {
    it("aggregates today sessions, scans, open tickets, and alerts", async () => {
      const scheduledClassId = new Types.ObjectId();
      const mockQuery: any = {};
      mockQuery.populate = jest.fn().mockReturnValue(mockQuery);
      mockQuery.sort = jest.fn().mockResolvedValue([
        {
          _id: scheduledClassId,
          cid: classId,
          coachId: [coachDocId],
          startTime: new Date("2026-09-15T18:00:00.000Z"),
          endTime: new Date("2026-09-15T19:00:00.000Z"),
          availableSlots: 5,
          bookedMembers: [{ uid: memberUid, method: "Package" }],
          scans: [
            { uid: { _id: memberUid, name: "Alice", phoneNumber: "010" }, scanTime: new Date(), method: "QR", status: true },
          ],
        },
      ]);
      (ScheduledClass.find as jest.Mock).mockReturnValue(mockQuery);

      // Coach mocks for getCoachLookupIds (called inside getSchedule and getScans)
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        userId: coachUserId,
        coachName: "Coach John",
        phoneNumber: "01011112222",
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      (Class.find as jest.Mock).mockResolvedValue([
        { _id: classId, title: "Strength & Conditioning", category: "STUDIO" },
      ]);

      (Member.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([
          {
            uid: { _id: memberUid, name: "Alice" },
            packages: [{ pkgId, status: "ACTIVE", remainingClasses: 2, pkgStartDate: new Date(), pkgEndDate: new Date(Date.now() + 2 * 86400000) }],
          },
        ]),
      });

      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "PT Package", category: "PERSONAL_TRAINING", coachId: coachDocId },
      ]);

      (DailyAttendance.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      (Ticket.countDocuments as jest.Mock).mockResolvedValue(2);
      (CoachNotification.countDocuments as jest.Mock).mockResolvedValue(1);

      const summary = await CoachService.getToday(coachDocId, coachUserId);

      expect(summary.tickets.openCount).toBe(2);
      expect(summary.unreadNotifications).toBe(1);
      expect(summary.scans.successCount).toBeGreaterThanOrEqual(1);
      expect(summary.ptAlerts.length).toBe(1);
    });
  });

  describe("Notifications & Tickets", () => {
    it("fetches and marks notifications as read", async () => {
      const notifId = new Types.ObjectId();
      (CoachNotification.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              _id: notifId,
              coachId: coachDocId,
              memberId: memberUid,
              memberName: "Alice",
              packageName: "PT 10",
              classesTotal: 10,
              createdAt: new Date(),
              read: false,
            },
          ]),
        }),
      });
      (CoachNotification.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const notifications = await CoachService.getNotifications(coachDocId);
      expect(notifications.length).toBe(1);
      expect(notifications[0].memberName).toBe("Alice");

      await CoachService.markAllNotificationsRead(coachDocId);
      expect(CoachNotification.updateMany).toHaveBeenCalledWith(
        { coachId: coachDocId, read: false },
        { $set: { read: true } }
      );
    });
  });

  describe("getPtAttendance", () => {
    it("filters PT attendance for that particular coach by package, direct coachId, and drop-in", async () => {
      const otherCoachId = new Types.ObjectId();
      const ptPkgId = new Types.ObjectId();

      (Package.find as jest.Mock).mockResolvedValue([
        { _id: ptPkgId, name: "Coach Special PT", coachId: coachDocId, category: "PERSONAL_TRAINING" },
      ]);

      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        coachName: "Sam",
      });

      const member1Id = new Types.ObjectId();
      const member2Id = new Types.ObjectId();
      const otherMemberId = new Types.ObjectId();

      (DailyAttendance.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          ptAttendance: [
            {
              uid: { _id: member1Id, name: "Trainee One", phoneNumber: "0101111" },
              method: "Coach Special PT",
              time: new Date("2026-09-20T10:00:00Z"),
              status: "SUCCESS",
            },
            {
              uid: { _id: member2Id, name: "Trainee Two", phoneNumber: "0102222" },
              method: "PT dropin with Sam",
              time: new Date("2026-09-20T11:00:00Z"),
              status: "SUCCESS",
            },
            {
              uid: { _id: otherMemberId, name: "Other Trainee", phoneNumber: "0103333" },
              method: "Other Package",
              coachId: otherCoachId,
              time: new Date("2026-09-20T12:00:00Z"),
              status: "SUCCESS",
            },
          ],
        }),
      });

      const results = await CoachService.getPtAttendance(coachDocId, new Date("2026-09-20"));

      expect(results.length).toBe(2);
      expect(results[0].member).toBe("Trainee One");
      expect(results[0].method).toBe("Coach Special PT");
      expect(results[1].member).toBe("Trainee Two");
      expect(results[1].method).toBe("PT dropin with Sam");
    });
  });

  describe("getClientAttendanceHistory", () => {
    it("aggregates and deduplicates PT check-ins, completed session deductions, PT drop-ins, and coach classes while filtering out other coaches and no-shows", async () => {
      const otherCoachId = new Types.ObjectId();
      const otherPkgId = new Types.ObjectId();
      const scId = new Types.ObjectId();

      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        userId: coachUserId,
        coachName: "Coach John",
        phoneNumber: "01011112222",
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [
          {
            pkgId,
            name: "10 PT with Coach John",
            status: "ACTIVE",
            remainingClasses: 6,
            pkgStartDate: new Date("2026-09-01T12:00:00Z"),
            pkgEndDate: new Date("2026-10-01T12:00:00Z"),
          },
          {
            pkgId: otherPkgId,
            name: "Other Coach PT",
            status: "ACTIVE",
            remainingClasses: 4,
            pkgStartDate: new Date("2026-09-01T12:00:00Z"),
            pkgEndDate: new Date("2026-10-01T12:00:00Z"),
          },
        ],
        ptAttendance: [
          {
            pkgId,
            date: "2026-09-10",
            attendanceTime: new Date("2026-09-10T10:15:00Z"),
          },
          {
            pkgId,
            date: "2026-09-15",
            attendanceTime: new Date("2026-09-15T12:00:00Z"),
          },
          {
            pkgId: otherPkgId,
            date: "2026-09-12",
            attendanceTime: new Date("2026-09-12T14:00:00Z"),
          },
        ],
        attendance: [{ scid: scId }],
      });

      (Package.find as jest.Mock).mockResolvedValue([
        {
          _id: pkgId,
          name: "10 PT with Coach John",
          coachId: coachDocId,
          category: "PERSONAL_TRAINING",
        },
        {
          _id: otherPkgId,
          name: "Other Coach PT",
          coachId: otherCoachId,
          category: "PERSONAL_TRAINING",
        },
      ]);

      (ScheduledClass.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([
          {
            _id: scId,
            cid: classId,
            coachId: [coachDocId],
            startTime: new Date("2026-09-22T15:00:00Z"),
            endTime: new Date("2026-09-22T16:00:00Z"),
            locationId: { branchName: "Main Branch" },
            scans: [
              {
                uid: memberUid,
                scanTime: new Date("2026-09-22T14:55:00Z"),
                method: "QR Scan",
                status: true,
              },
            ],
          },
        ]),
      });

      (Class.find as jest.Mock).mockResolvedValue([
        { _id: classId, title: "HIIT Workout", category: "STUDIO" },
      ]);

      (DailyAttendance.find as jest.Mock).mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          ptAttendance: [
            // Duplicate of 2026-09-10 member.ptAttendance entry
            {
              uid: memberUid,
              method: "10 PT with Coach John",
              coachId: coachDocId,
              time: new Date("2026-09-10T10:15:00Z"),
              status: "SUCCESS",
            },
            // PT drop-in with Coach John
            {
              uid: memberUid,
              method: "PT dropin with Coach John",
              coachId: coachDocId,
              time: new Date("2026-09-20T16:30:00Z"),
              status: "SUCCESS",
            },
            // PT drop-in with another coach (should be excluded)
            {
              uid: memberUid,
              method: "PT dropin with Other Coach",
              coachId: otherCoachId,
              time: new Date("2026-09-21T16:30:00Z"),
              status: "SUCCESS",
            },
          ],
        },
      ]);

      (DeductionLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(),
            coachId: coachDocId,
            memberId: memberUid,
            pkgId,
            reason: "Completed session. Upper body focus",
            sessionDate: new Date("2026-09-15T12:00:00Z"),
            classesRemainingAfter: 6,
            createdAt: new Date("2026-09-15T12:05:00Z"),
          },
          {
            _id: new Types.ObjectId(),
            coachId: coachDocId,
            memberId: memberUid,
            pkgId,
            reason: "No-show",
            sessionDate: new Date("2026-09-18T12:00:00Z"),
            classesRemainingAfter: 5,
            createdAt: new Date("2026-09-18T12:05:00Z"),
          },
        ]),
      });

      const history = await CoachService.getClientAttendanceHistory(
        coachDocId,
        memberUid.toString(),
      );

      // Should have 4 items sorted newest first:
      // 1. 2026-09-22 Class "HIIT Workout"
      // 2. 2026-09-20 PT Drop-In "PT dropin with Coach John"
      // 3. 2026-09-15 PT Coach Deduction "10 PT with Coach John" (enriched with reason)
      // 4. 2026-09-10 PT Check-in "10 PT with Coach John" (deduplicated)
      expect(history.length).toBe(4);
      expect(history[0]).toMatchObject({
        type: "CLASS",
        title: "HIIT Workout",
        method: "QR Scan",
        location: "Main Branch",
      });
      expect(history[1]).toMatchObject({
        type: "PT",
        title: "PT dropin with Coach John",
        method: "PT Drop-In",
      });
      expect(history[2]).toMatchObject({
        type: "PT",
        title: "10 PT with Coach John",
        method: "Coach Deduction",
        notes: "Completed session. Upper body focus",
      });
      expect(history[3]).toMatchObject({
        type: "PT",
        title: "10 PT with Coach John",
        method: "PT Check-in",
      });
    });

    it("throws ForbiddenError when coach has no link to the member", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: coachDocId,
        userId: coachUserId,
        coachName: "Coach John",
      });
      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });
      (Member.findOne as jest.Mock).mockResolvedValue({
        uid: memberUid,
        packages: [],
        ptAttendance: [],
        attendance: [],
      });
      (Package.find as jest.Mock).mockResolvedValue([]);
      (ScheduledClass.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      });
      (DailyAttendance.find as jest.Mock).mockResolvedValue([]);
      (DeductionLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      });

      await expect(
        CoachService.getClientAttendanceHistory(coachDocId, memberUid.toString()),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
