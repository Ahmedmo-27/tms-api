import { Request, Response } from "express";
import { Types } from "mongoose";
import { requireManagingCoach, CoachAuthRequest } from "../middlewares/coach.middleware";
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
});
