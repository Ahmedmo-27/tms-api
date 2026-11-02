import { Types } from "mongoose";
import { Server } from "http";
import { BookingsService } from "./bookings-service";
import Member from "../models/member";
import User from "../models/user";
import Coach from "../models/coach";
import DailyAttendance from "../models/dailyAttendance";
import OwedPtSession from "../models/owedPtSession";
import { PaymentsService } from "./payments-service";
import { runInTransaction } from "../utils/transaction";
import { SubscriptionsService } from "./subscriptions-service";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";
import { settleOwedPtSession } from "../controllers/admin/attendance-controller";
import { BadRequestError } from "../core/ApiError";

jest.mock("../models/member");
jest.mock("../models/user");
jest.mock("../models/coach");
jest.mock("../models/dailyAttendance");
jest.mock("../models/owedPtSession");
jest.mock("../models/package");
jest.mock("../models/nonUserPackage");
jest.mock("./payments-service");
jest.mock("../utils/transaction");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("PT Will Pay and Debt Tracking", () => {
  const uid = new Types.ObjectId().toString();
  const coachAId = new Types.ObjectId().toString();
  const coachBId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();
  const dayId = new Types.ObjectId().toString();
  const rowId = new Types.ObjectId().toString();
  const io = { emit: jest.fn() } as unknown as Server;
  const mockSession = {} as any;

  const memberDoc = {
    _id: new Types.ObjectId(),
    uid: { name: "Test Member", _id: new Types.ObjectId(uid), phoneNumber: "01011112222" },
  };

  const coachDocA = {
    _id: new Types.ObjectId(coachAId),
    coachName: "Coach A",
  };

  const coachDocB = {
    _id: new Types.ObjectId(coachBId),
    coachName: "Coach B",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) => fn(mockSession));
    (Member.findOne as jest.Mock).mockReturnValue({
      populate: jest.fn().mockResolvedValue(memberDoc),
      session: jest.fn().mockReturnThis(),
    });
    (Coach.findById as jest.Mock).mockImplementation(async (id: any) => {
      if (id?.toString() === coachAId) return coachDocA;
      if (id?.toString() === coachBId) return coachDocB;
      return null;
    });
    (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue({
      dayId,
      rowId,
    });
    (DailyAttendance.recordPtGuestAttendance as jest.Mock).mockResolvedValue({
      dayId,
      rowId,
    });
    (OwedPtSession.create as jest.Mock).mockResolvedValue([{}]);
    (PaymentsService.savePayment as jest.Mock).mockResolvedValue({ _id: new Types.ObjectId() });
  });

  describe("recordAdminPtMemberDropIn with WILL_PAY", () => {
    it("records WILL_PAY attendance and creates OwedPtSession without saving an upfront payment", async () => {
      await BookingsService.recordAdminPtMemberDropIn(
        uid,
        "WILL_PAY",
        io,
        locationId,
        coachAId,
        750,
      );

      // Verify payment was NOT created
      expect(PaymentsService.savePayment).not.toHaveBeenCalled();

      // Verify attendance was recorded with WILL_PAY
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "PT dropin with Coach A",
        mockSession,
        "WILL_PAY",
        io,
        locationId,
        coachAId,
        undefined
      );

      // Verify OwedPtSession was created with PENDING status
      expect(OwedPtSession.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            phoneNumber: "01011112222",
            uid: new Types.ObjectId(uid),
            clientName: "Test Member",
            coachId: new Types.ObjectId(coachAId),
            coachName: "Coach A",
            status: "PENDING",
            amount: 750,
            dailyAttendanceId: new Types.ObjectId(dayId),
            attendanceRowId: new Types.ObjectId(rowId),
          }),
        ],
        { session: mockSession }
      );
    });
  });

  describe("recordAdminPtGuestDropIn with WILL_PAY", () => {
    it("records guest WILL_PAY attendance and creates OwedPtSession tied to phone number", async () => {
      (User.findOne as jest.Mock).mockResolvedValue(null);

      await BookingsService.recordAdminPtGuestDropIn(
        "Guest Sarah",
        "01234567890",
        "WILL_PAY",
        io,
        locationId,
        coachAId,
        800,
      );

      // Verify payment was NOT created
      expect(PaymentsService.savePayment).not.toHaveBeenCalled();

      // Verify guest attendance recorded with WILL_PAY
      expect(DailyAttendance.recordPtGuestAttendance).toHaveBeenCalledWith(
        "Guest Sarah",
        "01234567890",
        "PT dropin with Coach A",
        mockSession,
        "WILL_PAY",
        io,
        locationId,
        coachAId,
        undefined
      );

      // Verify OwedPtSession was created tied to phone
      expect(OwedPtSession.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            phoneNumber: "01234567890",
            clientName: "Guest Sarah",
            coachId: new Types.ObjectId(coachAId),
            coachName: "Coach A",
            status: "PENDING",
            amount: 800,
          }),
        ],
        { session: mockSession }
      );
    });
  });

  describe("checkAndProcessPtDebtOnSubscription", () => {
    it("deducts owed session when subscribing to a PT package with the SAME trainer", async () => {
      const pkgWithCoachA = {
        _id: new Types.ObjectId(),
        name: "10 PT Coach A",
        category: "PERSONAL_TRAINING",
        coachId: new Types.ObjectId(coachAId),
        numberOfSessions: 10,
      };

      const mockOwed = {
        _id: new Types.ObjectId(),
        coachId: new Types.ObjectId(coachAId),
        coachName: "Coach A",
        attendanceDate: new Date("2026-10-15"),
        status: "PENDING",
        dailyAttendanceId: new Types.ObjectId(dayId),
        attendanceRowId: new Types.ObjectId(rowId),
        save: jest.fn().mockResolvedValue(true),
      };

      (OwedPtSession.find as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue([mockOwed]),
      });
      (DailyAttendance.updateOne as jest.Mock).mockResolvedValue({ matchedCount: 1 });

      const result = await SubscriptionsService.checkAndProcessPtDebtOnSubscription({
        uid,
        phoneNumber: "01011112222",
        pkg: pkgWithCoachA,
        session: mockSession,
      });

      expect(result.deductCount).toBe(1);
      expect(mockOwed.status).toBe("DEDUCTED");
      expect(mockOwed.save).toHaveBeenCalled();
      expect(DailyAttendance.updateOne).toHaveBeenCalledWith(
        { _id: mockOwed.dailyAttendanceId, "ptAttendance._id": mockOwed.attendanceRowId },
        {
          $set: {
            "ptAttendance.$.status": "SUCCESS",
            "ptAttendance.$.pkgId": pkgWithCoachA._id,
          },
        },
        { session: mockSession }
      );
    });

    it("throws UNPAID_PT_SESSION_WITH_OTHER_COACH when subscribing with a DIFFERENT trainer", async () => {
      const pkgWithCoachB = {
        _id: new Types.ObjectId(),
        name: "10 PT Coach B",
        category: "PERSONAL_TRAINING",
        coachId: new Types.ObjectId(coachBId),
        numberOfSessions: 10,
      };

      const mockOwedToCoachA = {
        _id: new Types.ObjectId(),
        coachId: new Types.ObjectId(coachAId),
        coachName: "Coach A",
        attendanceDate: new Date("2026-10-15"),
        status: "PENDING",
      };

      (OwedPtSession.find as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue([mockOwedToCoachA]),
      });

      await expect(
        SubscriptionsService.checkAndProcessPtDebtOnSubscription({
          uid,
          phoneNumber: "01011112222",
          pkg: pkgWithCoachB,
          session: mockSession,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it("throws UNPAID_PT_SESSION_WITH_OTHER_COACH when subscribing to a non-PT package while having unpaid PT sessions", async () => {
      const studioPkg = {
        _id: new Types.ObjectId(),
        name: "Studio 10 Sessions",
        category: "STUDIO",
        numberOfSessions: 10,
      };

      const mockOwedToCoachA = {
        _id: new Types.ObjectId(),
        coachId: new Types.ObjectId(coachAId),
        coachName: "Coach A",
        attendanceDate: new Date("2026-10-15"),
        status: "PENDING",
      };

      (OwedPtSession.find as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue([mockOwedToCoachA]),
      });

      await expect(
        SubscriptionsService.checkAndProcessPtDebtOnSubscription({
          uid,
          phoneNumber: "01011112222",
          pkg: studioPkg,
          session: mockSession,
        })
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("linkGuestRecordsToMember", () => {
    it("updates guest records and owed sessions with new member uid", async () => {
      (DailyAttendance.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
      (OwedPtSession.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      await SubscriptionsService.linkGuestRecordsToMember(uid, "01234567890", mockSession);

      expect(DailyAttendance.updateMany).toHaveBeenCalledWith(
        { "ptAttendance.guestPhone": "01234567890" },
        { $set: { "ptAttendance.$[elem].uid": new Types.ObjectId(uid) } },
        expect.objectContaining({ session: mockSession })
      );

      expect(OwedPtSession.updateMany).toHaveBeenCalledWith(
        { phoneNumber: "01234567890", uid: { $exists: false } },
        { $set: { uid: new Types.ObjectId(uid) } },
        { session: mockSession }
      );
    });
  });

  describe("settleOwedPtSession", () => {
    it("settles owed PT session with PAYMENT (Cash/Visa)", async () => {
      const mockOwed = {
        _id: new Types.ObjectId(),
        uid: new Types.ObjectId(uid),
        phoneNumber: "01011112222",
        clientName: "Test Member",
        coachId: new Types.ObjectId(coachAId),
        coachName: "Coach A",
        dailyAttendanceId: new Types.ObjectId(dayId),
        attendanceRowId: new Types.ObjectId(rowId),
        status: "PENDING",
        amount: 750,
        save: jest.fn().mockResolvedValue(true),
      };

      (OwedPtSession.findOne as jest.Mock).mockResolvedValue(mockOwed);
      (DailyAttendance.updateOne as jest.Mock).mockResolvedValue({ matchedCount: 1 });

      const req: any = {
        body: {
          sessionId: mockOwed._id.toString(),
          settlementType: "PAYMENT",
          paymentMethod: "CASH",
        },
        app: { get: jest.fn().mockReturnValue(io) },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const next = jest.fn((err) => {
        if (err) console.error("Error in settleOwedPtSession:", err);
      });

      await settleOwedPtSession(req, res, next);
      expect(next).not.toHaveBeenCalled();

      expect(PaymentsService.savePayment).toHaveBeenCalledWith(
        uid,
        750,
        "CASH",
        "DROPIN",
        mockSession,
        undefined,
        undefined,
        undefined,
        undefined,
        expect.any(String),
        expect.stringContaining("Settled owed PT with Coach A"),
        "Test Member",
        "01011112222",
        undefined,
        coachAId,
        "Coach A"
      );

      expect(mockOwed.status).toBe("PAID");
      expect(mockOwed.save).toHaveBeenCalled();
      expect(DailyAttendance.updateOne).toHaveBeenCalledWith(
        { _id: mockOwed.dailyAttendanceId, "ptAttendance._id": mockOwed.attendanceRowId },
        { $set: { "ptAttendance.$.status": "SUCCESS" } },
        { session: mockSession }
      );
    });

    it("rejects DEDUCTED settlement when package belongs to a different coach", async () => {
      const mockOwed = {
        _id: new Types.ObjectId(),
        uid: new Types.ObjectId(uid),
        coachId: new Types.ObjectId(coachAId),
        coachName: "Coach A",
        status: "PENDING",
      };

      const packageDocCoachB = {
        _id: new Types.ObjectId(),
        category: "PERSONAL_TRAINING",
        coachId: new Types.ObjectId(coachBId),
      };

      (OwedPtSession.findOne as jest.Mock).mockResolvedValue(mockOwed);
      (Package.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(packageDocCoachB),
      });

      const req: any = {
        body: {
          sessionId: mockOwed._id.toString(),
          settlementType: "DEDUCTED",
          pkgId: packageDocCoachB._id.toString(),
        },
        app: { get: jest.fn().mockReturnValue(io) },
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await settleOwedPtSession(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError));
    });
  });
});
