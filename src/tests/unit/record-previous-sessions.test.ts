import { Types } from "mongoose";
import {
  recordMemberPreviousSessions,
  adjustMemberPackageClasses,
} from "../../controllers/admin/package-controller";
import { SubscriptionsService } from "../../services/subscriptions-service";
import Member from "../../models/member";
import Package from "../../models/package";
import User from "../../models/user";
import DailyAttendance from "../../models/dailyAttendance";
import ScheduledClass from "../../models/scheduledClass";
import Class from "../../models/class";

jest.mock("../../models/scheduledClass", () => {
  const mockScls = {
    _id: new Types.ObjectId("69e75e4ceedc2cfac76e0999"),
    cid: new Types.ObjectId("69e75e4ceedc2cfac76e0172"),
    bookedMembers: [],
    scans: [],
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };
  const ctor: any = jest.fn().mockImplementation((data: any) => ({
    _id: new Types.ObjectId("69e75e4ceedc2cfac76e0999"),
    bookedMembers: [],
    scans: [],
    ...data,
    save: jest.fn().mockResolvedValue(true),
  }));
  ctor.findById = jest.fn().mockImplementation(() => {
    const p: any = Promise.resolve(mockScls);
    p.session = jest.fn().mockReturnValue(p);
    return p;
  });
  ctor.findOne = jest.fn().mockImplementation(() => {
    const p: any = Promise.resolve(mockScls);
    p.session = jest.fn().mockReturnValue(p);
    return p;
  });
  ctor.updateOne = jest.fn().mockImplementation(() => {
    const p: any = Promise.resolve({ acknowledged: true });
    p.session = jest.fn().mockReturnValue(p);
    return p;
  });
  return {
    __esModule: true,
    default: ctor,
  };
});

jest.mock("../../models/class", () => ({
  findById: jest.fn().mockImplementation(() => {
    const p: any = Promise.resolve({ _id: new Types.ObjectId("69e75e4ceedc2cfac76e0172"), title: "Flow Yoga" });
    p.session = jest.fn().mockReturnValue(p);
    return p;
  }),
}));


jest.mock("../../models/member");
jest.mock("../../models/package", () => {
  const actual = jest.requireActual("../../models/package");
  return {
    __esModule: true,
    ...actual,
    default: {
      findById: jest.fn(),
      findOne: jest.fn(),
    },
  };
});
jest.mock("../../models/user");
jest.mock("../../models/dailyAttendance");
jest.mock("../../models/nonUserPackage", () => ({
  findOne: jest.fn().mockImplementation(() => {
    const p: any = Promise.resolve(null);
    p.session = jest.fn().mockReturnValue(p);
    return p;
  }),
}));
jest.mock("../../models/coachNotification", () => ({
  create: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/payments-service", () => ({
  PaymentsService: {
    savePayment: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      amount: 1000,
    }),
  },
}));
jest.mock("../../services/egygap-erp-service", () => ({
  sendPaymentToRentalSystem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/transaction", () => ({
  runInTransaction: jest.fn(async (cb: any) => cb(null)),
}));
jest.mock("../../config/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

async function invokeController(fn: any, req: any, res: any) {
  return new Promise<void>((resolve, reject) => {
    const next = (err?: any) => {
      if (err) reject(err);
      else resolve();
    };
    const origJson = res.json;
    res.json = jest.fn((...args: any[]) => {
      origJson?.(...args);
      resolve();
      return res;
    });
    fn(req, res, next);
  });
}

describe("Unit Tests: Record Previous Session Dates & Edge Cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // SUITE 1: recordMemberPreviousSessions - Validation & Edge Cases
  // =========================================================================
  describe("recordMemberPreviousSessions - Validation & Error Handling", () => {
    it("should throw INVALID_REQUEST_BODY if uid is missing", async () => {
      const req: any = {
        body: {
          pkgId: new Types.ObjectId().toString(),
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INVALID_REQUEST_BODY",
        message: expect.stringContaining("required"),
      });
    });

    it("should throw INVALID_REQUEST_BODY if pkgId is missing", async () => {
      const req: any = {
        body: {
          uid: new Types.ObjectId().toString(),
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INVALID_REQUEST_BODY",
      });
    });

    it("should throw INVALID_REQUEST_BODY if pkgStartDate is missing", async () => {
      const req: any = {
        body: {
          uid: new Types.ObjectId().toString(),
          pkgId: new Types.ObjectId().toString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INVALID_REQUEST_BODY",
      });
    });

    it("should throw NO_DATES_PROVIDED if previousSessionDates is empty array", async () => {
      const req: any = {
        body: {
          uid: new Types.ObjectId().toString(),
          pkgId: new Types.ObjectId().toString(),
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: [],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "NO_DATES_PROVIDED",
        message: "At least one previous session date is required",
      });
    });

    it("should throw NO_DATES_PROVIDED if previousSessionDates contains only blank strings", async () => {
      const req: any = {
        body: {
          uid: new Types.ObjectId().toString(),
          pkgId: new Types.ObjectId().toString(),
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: ["   ", "", "\t"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "NO_DATES_PROVIDED",
      });
    });

    it("should throw MEMBER_NOT_FOUND if member does not exist", async () => {
      (Member.findOne as jest.Mock).mockResolvedValue(null);

      const req: any = {
        body: {
          uid: new Types.ObjectId().toString(),
          pkgId: new Types.ObjectId().toString(),
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "MEMBER_NOT_FOUND",
      });
    });

    it("should throw PACKAGE_NOT_FOUND if package does not exist on member", async () => {
      const uid = new Types.ObjectId().toString();
      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(),
            pkgStartDate: new Date("2026-10-01"),
            remainingClasses: 5,
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId: new Types.ObjectId().toString(), // Different package ID
          pkgStartDate: new Date("2026-10-01").toISOString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "PACKAGE_NOT_FOUND",
      });
    });

    it("should throw PACKAGE_NOT_FOUND if package start date does not match Cairo calendar day", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: new Date("2026-10-01T10:00:00.000Z"),
            remainingClasses: 5,
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: new Date("2026-10-05T10:00:00.000Z").toISOString(), // Different day
          previousSessionDates: ["2026-10-06"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "PACKAGE_NOT_FOUND",
      });
    });

    it("should throw INSUFFICIENT_CLASSES if dates count exceeds remaining classes", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 2,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-02", "2026-10-03", "2026-10-04"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INSUFFICIENT_CLASSES",
        message: expect.stringContaining("Only 2 classes remaining"),
      });
    });

    it("should throw INSUFFICIENT_CLASSES if remaining classes is already 0", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 0,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-02"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INSUFFICIENT_CLASSES",
        message: expect.stringContaining("Only 0 classes remaining"),
      });
    });

    it("should throw INVALID_DATE if a date string cannot be parsed", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["not-a-valid-date"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "INVALID_DATE",
        message: expect.stringContaining("Invalid session date"),
      });
    });

    it("should throw FUTURE_DATE_NOT_ALLOWED if a date is in the future", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2099-01-01"],
        },
        app: { get: jest.fn() },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(recordMemberPreviousSessions, req, res)).rejects.toMatchObject({
        code: "FUTURE_DATE_NOT_ALLOWED",
        message: "Previous session dates cannot be in the future",
      });
    });
  });

  // =========================================================================
  // SUITE 2: recordMemberPreviousSessions - Success & State Transitions
  // =========================================================================
  describe("recordMemberPreviousSessions - State Transitions & PT Handling", () => {
    it("should record partial past sessions, decrement classes, push adjustment records, and NOT emit SUCCESS-SCAN", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "10-Class Pack",
        category: "GROUP_CLASS",
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-02", "2026-10-05"],
          reason: "Attended earlier front desk missed",
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];
      expect(responseData.message).toBe("Previous sessions recorded successfully!");

      // 5 remaining - 2 sessions = 3 remaining
      expect(Member.editPackageClasses).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate.toISOString(),
        3
      );

      // Verify Member.pushAdjustmentRecord called twice with the custom reason
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledTimes(2);
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate,
        expect.objectContaining({
          reason: "Attended earlier front desk missed",
          type: "DEDUCT",
          amount: 1,
        }),
        null
      );

      // Package status should NOT transition to COMPLETED (since remaining = 3)
      expect(Member.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        { $set: { "packages.$.status": "COMPLETED" } },
        expect.anything()
      );

      // Crucial: SUCCESS-SCAN must NOT be emitted
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    it("should transition package status to COMPLETED when past sessions consume all remaining classes", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 2,
            name: "Short Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "Short Pack",
        category: "GROUP_CLASS",
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-02", "2026-10-03"],
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      // 2 remaining - 2 sessions = 0 remaining
      expect(Member.editPackageClasses).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate.toISOString(),
        0
      );

      // Should mark package status COMPLETED
      expect(Member.updateOne).toHaveBeenCalledWith(
        {
          uid: new Types.ObjectId(uid),
          "packages.pkgId": new Types.ObjectId(pkgId),
          "packages.pkgStartDate": startDate,
        },
        { $set: { "packages.$.status": "COMPLETED" } },
        expect.anything()
      );
    });

    it("should handle PT packages: record DailyAttendance and push to ptAttendance for each historical date", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const coachId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 4,
            name: "PT 10 Sessions",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (DailyAttendance.recordPtAttendance as any) = jest.fn().mockResolvedValue(undefined);
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "PT 10 Sessions",
        category: "PERSONAL_TRAINING",
        coachId: new Types.ObjectId(coachId),
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-02", "2026-10-04"],
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      // Verify Member.updateOne called with $addToSet for ptAttendance for each date
      expect(Member.updateOne).toHaveBeenCalledWith(
        { uid: new Types.ObjectId(uid) },
        expect.objectContaining({
          $addToSet: expect.objectContaining({
            ptAttendance: expect.anything(),
          }),
        }),
        { session: null }
      );

      // Verify DailyAttendance.recordPtAttendance was called twice with coachId and past date
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledTimes(2);
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "PT 10 Sessions",
        null,
        "SUCCESS",
        mockIo,
        null,
        coachId,
        expect.any(Date),
        pkgId
      );

      // Ensure mockIo.emit was never called directly
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    it("should allow multiple sessions recorded on the same historical date (morning & evening)", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "10-Class Pack",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "10-Class Pack",
        category: "GROUP_CLASS",
      });

      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          // Two sessions attended on the same day: morning & evening
          previousSessionDates: ["2026-10-05T09:00:00.000Z", "2026-10-05T18:00:00.000Z"],
        },
        app: { get: jest.fn().mockReturnValue({ emit: jest.fn() }) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      // 5 - 2 = 3
      expect(Member.editPackageClasses).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate.toISOString(),
        3
      );
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // SUITE 3: SubscriptionsService.frontDeskSubscribeToPackage
  // =========================================================================
  describe("SubscriptionsService.frontDeskSubscribeToPackage - Previous Session Edge Cases", () => {
    it("should deduct previousSessionDates on initial package subscription and push adjustment records", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = "2026-10-01";

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "10-Class Pack",
        numberOfSessions: 10,
        price: 2500,
        expiryPeriod: 60,
        category: "GROUP_CLASS",
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);
      (Member.hasPackageOnStartDay as any) = jest.fn().mockResolvedValue(false);
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(uid),
          name: "Test Member",
          phoneNumber: "01012345678",
          role: "member",
          save: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const ioMock = { emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: jest.fn() }) };

      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        startDate,
        "CASH",
        undefined, // paymentDate
        undefined, // amount
        undefined, // note
        ioMock as any, // io
        undefined, // locationId
        false, // pendingDeduction
        ["2026-10-02", "2026-10-03", "2026-10-04"] // 3 previous sessions
      );

      // Remaining classes should be 10 - 3 = 7
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "10-Class Pack",
        7,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // 3 adjustment records pushed with historical attendance dates
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledTimes(3);
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
        uid,
        pkgId,
        expect.any(Date),
        expect.objectContaining({
          type: "DEDUCT",
          amount: 1,
          attendanceDate: expect.any(Date),
        }),
        null
      );

      // Package status should NOT be set to COMPLETED since 7 classes remain
      expect(Member.updateOne).not.toHaveBeenCalledWith(
        expect.anything(),
        { $set: { "packages.$.status": "COMPLETED" } },
        expect.anything()
      );
    });

    it("should set package status to COMPLETED immediately if previous sessions equal total sessions", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = "2026-10-01";

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "5-Class Pack",
        numberOfSessions: 5,
        price: 1500,
        expiryPeriod: 30,
        category: "GROUP_CLASS",
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);
      (Member.hasPackageOnStartDay as any) = jest.fn().mockResolvedValue(false);
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(uid),
          name: "Test Member",
          phoneNumber: "01012345678",
          role: "member",
          save: jest.fn().mockResolvedValue(undefined),
        }),
      });

      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        startDate,
        "CASH",
        undefined, // paymentDate
        undefined, // amount
        undefined, // note
        undefined, // io
        undefined, // locationId
        false,     // pendingDeduction
        ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"] // 5 sessions
      );

      // Remaining classes should be 0
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "5-Class Pack",
        0,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // Package status must be set to COMPLETED
      expect(Member.updateOne).toHaveBeenCalledWith(
        {
          uid: new Types.ObjectId(uid),
          "packages.pkgId": mockPkg._id,
          "packages.pkgStartDate": expect.any(Date),
        },
        { $set: { "packages.$.status": "COMPLETED" } },
        { session: null }
      );
    });

    it("should throw INVALID_PREVIOUS_SESSIONS if previous dates count exceeds package total sessions", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "3-Class Pack",
        numberOfSessions: 3,
        price: 1000,
        category: "GROUP_CLASS",
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);

      await expect(
        SubscriptionsService.frontDeskSubscribeToPackage(
          uid,
          pkgId,
          "2026-10-01",
          "CASH",
          undefined, // paymentDate
          undefined, // amount
          undefined, // note
          undefined, // io
          undefined, // locationId
          false,     // pendingDeduction
          ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"] // 4 dates on a 3-class pack
        )
      ).rejects.toMatchObject({
        code: "INVALID_PREVIOUS_SESSIONS",
        message: expect.stringContaining("Cannot record more previous sessions (4) than package total (3)"),
      });
    });

    it("should throw FUTURE_DATE_NOT_ALLOWED if any previous session date is in the future", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "5-Class Pack",
        numberOfSessions: 5,
        price: 1500,
        category: "GROUP_CLASS",
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);

      await expect(
        SubscriptionsService.frontDeskSubscribeToPackage(
          uid,
          pkgId,
          "2026-10-01",
          "CASH",
          undefined, // paymentDate
          undefined, // amount
          undefined, // note
          undefined, // io
          undefined, // locationId
          false,     // pendingDeduction
          ["2099-12-31"] // Future date
        )
      ).rejects.toMatchObject({
        code: "FUTURE_DATE_NOT_ALLOWED",
      });
    });

    it("should record PT attendance on previous dates during subscription without socket emission", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const coachId = new Types.ObjectId().toString();
      const startDate = "2026-10-01";

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "PT 10 Pack",
        numberOfSessions: 10,
        price: 5000,
        expiryPeriod: 60,
        category: "PERSONAL_TRAINING",
        coachId: new Types.ObjectId(coachId),
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);
      (Member.hasPackageOnStartDay as any) = jest.fn().mockResolvedValue(false);
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (DailyAttendance.recordPtAttendance as any) = jest.fn().mockResolvedValue(undefined);
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(uid),
          name: "Test Member",
          phoneNumber: "01012345678",
          role: "member",
          save: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const ioMock = {
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      };

      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        startDate,
        "CASH",
        undefined, // paymentDate
        undefined, // amount
        undefined, // note
        ioMock as any, // io
        undefined, // locationId
        false,     // pendingDeduction
        ["2026-10-02", "2026-10-04"] // 2 PT previous sessions
      );

      // Remaining classes = 10 - 2 = 8
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "PT 10 Pack",
        8,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // DailyAttendance.recordPtAttendance must be called for each previous session
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledTimes(2);
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "PT 10 Pack",
        null,
        "SUCCESS",
        ioMock,
        undefined,
        coachId,
        expect.any(Date),
        pkgId
      );

      // ioMock.emit("SUCCESS-SCAN") must NOT be triggered
      expect(ioMock.emit).not.toHaveBeenCalledWith("SUCCESS-SCAN", expect.anything());
    });

    it("should support backward compatibility: pendingDeduction=true when previousSessionDates is empty", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = "2026-10-01";

      const mockPkg: any = {
        _id: new Types.ObjectId(pkgId),
        name: "10-Class Pack",
        numberOfSessions: 10,
        price: 2500,
        expiryPeriod: 60,
        category: "GROUP_CLASS",
      };

      (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
      (Package.findById as jest.Mock).mockResolvedValue(mockPkg);
      (Member.hasPackageOnStartDay as any) = jest.fn().mockResolvedValue(false);
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(uid),
          name: "Test Member",
          phoneNumber: "01012345678",
          role: "member",
          save: jest.fn().mockResolvedValue(undefined),
        }),
      });

      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        startDate,
        "CASH",
        undefined, // paymentDate
        undefined, // amount
        undefined, // note
        undefined, // io
        undefined, // locationId
        true,      // pendingDeduction = true
        []         // empty previousSessionDates
      );

      // Remaining classes = 10 - 1 = 9
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "10-Class Pack",
        9,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // Legacy pending deduction record pushed
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
        uid,
        pkgId,
        expect.any(Date),
        expect.objectContaining({
          reason: "Attended a class using this package",
          type: "DEDUCT",
          amount: 1,
        }),
        null
      );
    });
  });

  // =========================================================================
  // SUITE 4: adjustMemberPackageClasses - Socket Suppression Guard
  // =========================================================================
  describe("adjustMemberPackageClasses - Socket Suppression Guard & Date Rules", () => {
    it("should NOT emit SUCCESS-SCAN when targetDate is in the past", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "PT 10 Sessions",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "PT 10 Sessions",
        category: "PERSONAL_TRAINING",
      });
      (DailyAttendance.recordPtAttendance as any) = jest.fn().mockResolvedValue(undefined);

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          amount: 1,
          type: "DEDUCT",
          reason: "Completed session - past session",
          sessionDate: "2026-10-05", // historical date
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(adjustMemberPackageClasses, req, res);

      expect(res.json).toHaveBeenCalled();
      // Crucial: mockIo.emit should NOT be called because sessionDate was in the past
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    it("should emit SUCCESS-SCAN when targetDate is today in Cairo time", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "PT 10 Sessions",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "PT 10 Sessions",
        category: "PERSONAL_TRAINING",
      });
      (DailyAttendance.recordPtAttendance as any) = jest.fn().mockResolvedValue(undefined);

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          amount: 1,
          type: "DEDUCT",
          reason: "Completed session - attended today",
          sessionDate: new Date().toISOString(), // TODAY
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(adjustMemberPackageClasses, req, res);

      expect(res.json).toHaveBeenCalled();
      // Should emit SUCCESS-SCAN because sessionDate is today
      expect(mockIo.emit).toHaveBeenCalledWith("SUCCESS-SCAN", expect.objectContaining({
        code: "PT_CLASS_ATTENDED",
        memberId: uid,
      }));
    });

    it("should NOT emit SUCCESS-SCAN when adjustment type is ADD even for today", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "PT 10 Sessions",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "PT 10 Sessions",
        category: "PERSONAL_TRAINING",
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          amount: 2,
          type: "ADD",
          reason: "Bonus classes added",
          sessionDate: new Date().toISOString(),
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(adjustMemberPackageClasses, req, res);

      // type === "ADD" is not an attendance check-in, so SUCCESS-SCAN must NOT be emitted
      expect(mockIo.emit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SUITE 5: Packages with Classes vs Non-Class (Open Gym / Default Scan)
  // =========================================================================
  describe("Class Packages & Default Scan on Scans Monitor", () => {
    it("should record past session for a package with classes: book member and push scan to ScheduledClass", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const classId = new Types.ObjectId("69e75e4ceedc2cfac76e0172").toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 5,
            name: "10 Studio",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "10 Studio",
        category: "STUDIO",
        opensClasses: [{ _id: new Types.ObjectId(classId), title: "Flow Yoga" }],
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: [
            {
              date: "2026-10-05",
              classId,
              className: "Flow Yoga",
            },
          ],
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      // Verify ScheduledClass updated with bookedMember and scan
      expect(ScheduledClass.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({
          $push: expect.objectContaining({
            bookedMembers: expect.objectContaining({
              uid: new Types.ObjectId(uid),
              method: "10 Studio",
            }),
          }),
        }),
        expect.anything()
      );

      expect(ScheduledClass.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({
          $push: expect.objectContaining({
            scans: expect.objectContaining({
              uid: new Types.ObjectId(uid),
              method: "10 Studio",
              status: true,
            }),
          }),
        }),
        expect.anything()
      );

      // Verify Member bookings and attendance updated
      expect(Member.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ uid: new Types.ObjectId(uid) }),
        expect.objectContaining({
          $push: expect.objectContaining({
            attendance: expect.objectContaining({
              scid: expect.anything(),
            }),
          }),
        }),
        expect.anything()
      );

      // Verify adjustment record has the specific class name
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate,
        expect.objectContaining({
          className: "Flow Yoga",
          type: "DEDUCT",
          amount: 1,
        }),
        null
      );

      // Verify NO live socket emission for past date
      expect(mockIo.emit).not.toHaveBeenCalled();
    });

    it("should record default scan on DailyAttendance.openGymAttendance when package has NO classes (Open Gym)", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 10,
            name: "1 Month Open Gym",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      (DailyAttendance.recordOpenGymAttendance as any) = jest.fn().mockResolvedValue(undefined);
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "1 Month Open Gym",
        category: "OPEN_GYM",
        opensClasses: [],
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-03"],
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(recordMemberPreviousSessions, req, res);

      // Verify DailyAttendance.recordOpenGymAttendance called with pastDate
      expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledWith(
        uid,
        "1 Month Open Gym",
        null,
        "SUCCESS",
        mockIo,
        null,
        expect.any(Date),
        pkgId
      );

      // Verify adjustment record pushed
      expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
        uid,
        pkgId,
        startDate,
        expect.objectContaining({
          className: "1 Month Open Gym",
          type: "DEDUCT",
          amount: 1,
        }),
        null
      );
    });

    it("should handle graceful conflict when open gym attendance was already recorded on that past date", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const startDate = new Date("2026-10-01");

      const mockMember: any = {
        uid,
        packages: [
          {
            pkgId: new Types.ObjectId(pkgId),
            pkgStartDate: startDate,
            remainingClasses: 10,
            name: "Space Membership",
          },
        ],
      };
      (Member.findOne as jest.Mock).mockResolvedValue(mockMember);
      (Member.editPackageClasses as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });
      const conflictErr = new Error("Attendance was already recorded");
      (conflictErr as any).code = "ATTENDANCE_ALREADY_RECORDED";
      (DailyAttendance.recordOpenGymAttendance as any) = jest.fn().mockRejectedValue(conflictErr);
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "Space Membership",
        category: "SPACE_MEMBERSHIP",
        opensClasses: [],
      });

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: {
          uid,
          pkgId,
          pkgStartDate: startDate.toISOString(),
          previousSessionDates: ["2026-10-04"],
        },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      // Should NOT throw an error - conflict is gracefully ignored
      await expect(invokeController(recordMemberPreviousSessions, req, res)).resolves.not.toThrow();
      expect(res.json).toHaveBeenCalled();
    });

    it("SubscriptionsService: should record ScheduledClass scan when subscribing to a package with classes", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();
      const classId = new Types.ObjectId("69e75e4ceedc2cfac76e0172").toString();

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid,
        packages: [],
      });
      (User.findOne as jest.Mock).mockImplementation(() => {
        const p: any = Promise.resolve({ _id: new Types.ObjectId(uid), name: "Sara", role: "member" });
        p.session = jest.fn().mockReturnValue(p);
        return p;
      });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "5 Studio",
        price: 2500,
        numberOfSessions: 5,
        expiryPeriod: 30,
        category: "STUDIO",
        opensClasses: [{ _id: new Types.ObjectId(classId), title: "Flow Yoga" }],
      });
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (Member.updateOne as any) = jest.fn().mockResolvedValue({ acknowledged: true });

      const mockIo: any = { emit: jest.fn() };
      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        "2026-10-01",
        "Cash",
        undefined,
        undefined,
        undefined,
        mockIo,
        undefined,
        false,
        [
          {
            date: "2026-10-02",
            classId,
            className: "Flow Yoga",
          },
        ]
      );

      // Remaining classes should be 5 - 1 = 4
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "5 Studio",
        4,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // ScheduledClass should have scan recorded
      expect(ScheduledClass.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({
          $push: expect.objectContaining({
            scans: expect.objectContaining({
              uid: new Types.ObjectId(uid),
              status: true,
            }),
          }),
        }),
        expect.anything()
      );
    });

    it("SubscriptionsService: should record default open gym scan when subscribing to Open Gym package with past sessions", async () => {
      const uid = new Types.ObjectId().toString();
      const pkgId = new Types.ObjectId().toString();

      (Member.findOne as jest.Mock).mockResolvedValue({
        uid,
        packages: [],
      });
      (User.findOne as jest.Mock).mockImplementation(() => {
        const p: any = Promise.resolve({ _id: new Types.ObjectId(uid), name: "Ahmed", role: "member" });
        p.session = jest.fn().mockReturnValue(p);
        return p;
      });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(pkgId),
        name: "10 Open Gym",
        price: 1500,
        numberOfSessions: 10,
        expiryPeriod: 30,
        category: "OPEN_GYM",
        opensClasses: [],
      });
      (Member.addPackage as any) = jest.fn().mockResolvedValue(undefined);
      (Member.pushAdjustmentRecord as any) = jest.fn().mockResolvedValue(undefined);
      (DailyAttendance.recordOpenGymAttendance as any) = jest.fn().mockResolvedValue(undefined);

      const mockIo: any = { emit: jest.fn() };
      await SubscriptionsService.frontDeskSubscribeToPackage(
        uid,
        pkgId,
        "2026-10-01",
        "Visa",
        undefined,
        undefined,
        undefined,
        mockIo,
        undefined,
        false,
        ["2026-10-03", "2026-10-05"]
      );

      // 10 - 2 = 8 remaining classes
      expect(Member.addPackage).toHaveBeenCalledWith(
        uid,
        pkgId,
        "10 Open Gym",
        8,
        expect.any(String),
        expect.any(String),
        null,
        undefined,
        undefined
      );

      // DailyAttendance.recordOpenGymAttendance called twice
      expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledTimes(2);
    });
  });

});
