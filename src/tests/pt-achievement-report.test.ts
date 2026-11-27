import { Request, Response } from "express";
import { Types } from "mongoose";
import { requireManagingCoach, CoachAuthRequest } from "../middlewares/coach.middleware";
import { authorizeUser, AuthRequest } from "../middlewares/auth.middleware";
import { getPtAchievementReport } from "../controllers/admin/pt-achievement-controller";
import { PtAchievementService } from "../services/pt-achievement-service";
import User from "../models/user";
import Coach from "../models/coach";
import Package from "../models/package";
import Payment from "../models/payment";
import Member from "../models/member";
import DeductionLog from "../models/deductionLog";
import { ForbiddenError } from "../core/ApiError";

jest.mock("../models/user");
jest.mock("../models/coach");
jest.mock("../models/package");
jest.mock("../models/payment");
jest.mock("../models/member");
jest.mock("../models/deductionLog");

describe("PT Achievement Report", () => {
  describe("requireManagingCoach middleware", () => {
    it("allows access when user has managing_coach role and canViewPtReports is true", async () => {
      const mockCoachId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ role: "managing_coach", canViewPtReports: true }),
      });

      const req = {
        coachId: mockCoachId,
      } as unknown as CoachAuthRequest;
      const res = {} as Response;
      const next = jest.fn();

      await requireManagingCoach(req as Request, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("throws ForbiddenError when user has managing_coach role but canViewPtReports is false", async () => {
      const mockCoachId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ role: "managing_coach", canViewPtReports: false }),
      });
      (Coach.findById as jest.Mock).mockResolvedValue({ canViewPtReports: false });

      const req = {
        coachId: mockCoachId,
        coachDocId: new Types.ObjectId(),
      } as unknown as CoachAuthRequest;
      const res = {} as Response;
      const next = jest.fn();

      await requireManagingCoach(req as Request, res, next);
      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe("INSUFFICIENT_PERMISSIONS");
      expect(err.message).toBe("PT Reports are not enabled for your account");
    });

    it("allows access when user has managing_coach role and linked coach doc has canViewPtReports true", async () => {
      const mockCoachId = new Types.ObjectId();
      const mockCoachDocId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ role: "managing_coach", canViewPtReports: false }),
      });
      (Coach.findById as jest.Mock).mockResolvedValue({ canViewPtReports: true });

      const req = {
        coachId: mockCoachId,
        coachDocId: mockCoachDocId,
      } as unknown as CoachAuthRequest;
      const res = {} as Response;
      const next = jest.fn();

      await requireManagingCoach(req as Request, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("throws ForbiddenError when user has standard coach role even if canViewPtReports is true", async () => {
      const mockCoachId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ role: "coach" }),
      });

      const req = {
        coachId: mockCoachId,
      } as unknown as CoachAuthRequest;
      const res = {} as Response;
      const next = jest.fn();

      await requireManagingCoach(req as Request, res, next);
      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe("INSUFFICIENT_PERMISSIONS");
    });

    it("throws ForbiddenError when user does not exist", async () => {
      const mockCoachId = new Types.ObjectId();
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = {
        coachId: mockCoachId,
      } as unknown as CoachAuthRequest;
      const res = {} as Response;
      const next = jest.fn();

      await requireManagingCoach(req as Request, res, next);
      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(ForbiddenError);
    });
  });

  describe("resolveDateRange", () => {
    it("calculates correct Monday to Sunday weekly range in Cairo timezone", () => {
      // 2026-10-07 is Wednesday -> Monday is 2026-10-05, Sunday is 2026-10-11
      const range = PtAchievementService.resolveDateRange({
        filterType: "weekly",
        date: "2026-10-07",
      });

      expect(range.startKey).toBe("2026-10-05");
      expect(range.endKey).toBe("2026-10-11");
    });

    it("calculates correct monthly range for given month", () => {
      const range = PtAchievementService.resolveDateRange({
        filterType: "monthly",
        month: "2026-10",
      });

      expect(range.startKey).toBe("2026-10-01");
      expect(range.endKey).toBe("2026-10-31");
    });

    it("handles February in a leap year vs non-leap year correctly", () => {
      const range = PtAchievementService.resolveDateRange({
        filterType: "monthly",
        month: "2024-02",
      });

      expect(range.startKey).toBe("2024-02-01");
      expect(range.endKey).toBe("2024-02-29");
    });

    it("uses custom date range when filterType is date", () => {
      const range = PtAchievementService.resolveDateRange({
        filterType: "date",
        startDate: "2026-10-01",
        endDate: "2026-10-15",
      });

      expect(range.startKey).toBe("2026-10-01");
      expect(range.endKey).toBe("2026-10-15");
    });

    it("swaps startDate and endDate if startDate is after endDate", () => {
      const range = PtAchievementService.resolveDateRange({
        filterType: "date",
        startDate: "2026-10-20",
        endDate: "2026-10-10",
      });

      expect(range.startKey).toBe("2026-10-10");
      expect(range.endKey).toBe("2026-10-20");
    });
  });

  describe("getReport", () => {
    const chainable = (val: unknown) => {
      const obj: any = {
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(val),
      };
      return obj;
    };

    it("separates Mindspace PT from Online PT and excludes expired or 0-class packages from active clients", async () => {
      const coachId = new Types.ObjectId();
      const mindspacePkgId = new Types.ObjectId();
      const onlinePkgId = new Types.ObjectId();
      const activeUserId = new Types.ObjectId();
      const zeroClassUserId = new Types.ObjectId();
      const expiredUserId = new Types.ObjectId();
      const onlineUserId = new Types.ObjectId();

      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      (Coach.find as jest.Mock).mockReturnValue(
        chainable([{ _id: coachId, coachName: "Salma", phoneNumber: "01000000001" }]),
      );
      (Package.find as jest.Mock).mockReturnValue(
        chainable([
          { _id: mindspacePkgId, name: "10 Personal Training with Salma", numberOfSessions: 10, price: 5000, coachId },
          { _id: onlinePkgId, name: "1 month online PT with Salma", numberOfSessions: 12, price: 3000, coachId },
        ]),
      );

      (Member.find as jest.Mock)
        .mockReturnValueOnce(chainable([])) // scan members (mindspace)
        .mockReturnValueOnce(
          chainable([
            {
              uid: activeUserId,
              packages: [
                { _id: new Types.ObjectId(), pkgId: mindspacePkgId, status: "ACTIVE", pkgEndDate: futureDate, remainingClasses: 2 },
              ],
            },
            {
              uid: zeroClassUserId,
              packages: [
                { _id: new Types.ObjectId(), pkgId: mindspacePkgId, status: "ACTIVE", pkgEndDate: futureDate, remainingClasses: 0 },
              ],
            },
            {
              uid: expiredUserId,
              packages: [
                { _id: new Types.ObjectId(), pkgId: mindspacePkgId, status: "ACTIVE", pkgEndDate: pastDate, remainingClasses: 4 },
              ],
            },
          ]),
        )
        .mockReturnValueOnce(chainable([])) // scan members (online)
        .mockReturnValueOnce(
          chainable([
            {
              uid: onlineUserId,
              packages: [
                { _id: new Types.ObjectId(), pkgId: onlinePkgId, status: "ACTIVE", pkgEndDate: futureDate, remainingClasses: 5 },
              ],
            },
          ]),
        );

      (DeductionLog.find as jest.Mock)
        .mockReturnValueOnce(
          chainable([
            { _id: new Types.ObjectId(), coachId, pkgId: mindspacePkgId, memberId: activeUserId, sessionDate: new Date("2026-11-25T10:00:00Z") },
            { _id: new Types.ObjectId(), coachId, pkgId: onlinePkgId, memberId: onlineUserId, sessionDate: new Date("2026-11-25T11:00:00Z") },
          ]),
        )
        .mockReturnValueOnce(
          chainable([
            { _id: new Types.ObjectId(), coachId, pkgId: mindspacePkgId, memberId: activeUserId, sessionDate: new Date("2026-11-25T10:00:00Z") },
            { _id: new Types.ObjectId(), coachId, pkgId: onlinePkgId, memberId: onlineUserId, sessionDate: new Date("2026-11-25T11:00:00Z") },
          ]),
        );

      (Payment.find as jest.Mock)
        .mockReturnValueOnce(
          chainable([{ _id: new Types.ObjectId(), pkgId: mindspacePkgId, uid: activeUserId, amount: 5000, paymentTime: new Date("2026-11-25T09:00:00Z") }]),
        )
        .mockReturnValueOnce(
          chainable([{ _id: new Types.ObjectId(), pkgId: onlinePkgId, uid: onlineUserId, amount: 3000, paymentTime: new Date("2026-11-25T09:00:00Z") }]),
        );

      (User.find as jest.Mock).mockReturnValue(
        chainable([
          { _id: activeUserId, name: "Active Member", phoneNumber: "01011111111" },
          { _id: onlineUserId, name: "Online Member", phoneNumber: "01022222222" },
        ]),
      );

      const mindspaceReport = await PtAchievementService.getReport({
        filterType: "date",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        ptType: "mindspace",
      });

      expect(mindspaceReport.range.ptType).toBe("mindspace");
      expect(mindspaceReport.totals.boughtPackages).toBe(1);
      expect(mindspaceReport.totals.boughtRevenue).toBe(5000);
      expect(mindspaceReport.totals.deductionSessions).toBe(1);
      expect(mindspaceReport.totals.activeClients).toBe(1);
      expect(mindspaceReport.totals.remainingSessions).toBe(2);
      expect(mindspaceReport.expiringSoonPackages).toHaveLength(1);
      expect(mindspaceReport.expiringSoonPackages?.[0].memberId).toBe(activeUserId.toString());

      const onlineReport = await PtAchievementService.getReport({
        filterType: "date",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        ptType: "online",
      });

      expect(onlineReport.range.ptType).toBe("online");
      expect(onlineReport.totals.boughtPackages).toBe(1);
      expect(onlineReport.totals.boughtRevenue).toBe(3000);
      expect(onlineReport.totals.deductionSessions).toBe(1);
      expect(onlineReport.totals.activeClients).toBe(1);
      expect(onlineReport.totals.remainingSessions).toBe(5);
    });
  });

  describe("admin GET /admin/pt-achievement", () => {
    it("allows management role and rejects accountant for the management-only gate", async () => {
      const allowManagement = authorizeUser(["management"]);

      const managementReq = {
        user: { role: "management" },
      } as unknown as AuthRequest;
      const managementNext = jest.fn();
      await allowManagement(managementReq as Request, {} as Response, managementNext);
      expect(managementNext).toHaveBeenCalledWith();

      const accountantReq = {
        user: { role: "accountant" },
      } as unknown as AuthRequest;
      const accountantNext = jest.fn();
      await allowManagement(accountantReq as Request, {} as Response, accountantNext);
      expect(accountantNext).toHaveBeenCalled();
      const err = accountantNext.mock.calls[0][0];
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.code).toBe("INSUFFICIENT_PERMISSIONS");
    });

    it("forwards query params including ptType to PtAchievementService.getReport", async () => {
      const report = {
        range: { startDate: "2026-11-01", endDate: "2026-11-30", filterType: "date", ptType: "online" },
        totals: {},
        coaches: [],
      };
      const getReportSpy = jest
        .spyOn(PtAchievementService, "getReport")
        .mockResolvedValue(report as any);

      const req = {
        query: {
          filterType: "date",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          coachId: "coach-1",
          ptType: "online",
        },
      } as unknown as Request;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response;
      const next = jest.fn();

      await getPtAchievementReport(req, res, next);

      expect(getReportSpy).toHaveBeenCalledWith({
        filterType: "date",
        date: undefined,
        month: undefined,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        coachId: "coach-1",
        ptType: "online",
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "PT achievement report",
          data: report,
        }),
      );
      expect(next).not.toHaveBeenCalled();

      getReportSpy.mockRestore();
    });
  });
});
