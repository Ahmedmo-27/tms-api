import { Types } from "mongoose";
import ScheduledClass from "../models/scheduledClass";
import { CoachService } from "./coach-service";
import { SchedulerService } from "./scheduler-service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../core/ApiError";

jest.mock("../models/scheduledClass");

describe("Attendance Confirmation & Missing Place", () => {
  const mockCoachDocId = new Types.ObjectId();
  const mockOtherCoachDocId = new Types.ObjectId();
  const mockScid = new Types.ObjectId().toString();

  /**
   * Create a mock ScheduledClass with a given number of booked members and
   * scans. The `scansSuccessCount` controls how many scans have status=true
   * (SUCCESS), which is what hasMissingPlace now compares against.
   */
  const createMockSession = (opts: {
    startTime: Date;
    endTime: Date;
    bookedCount: number;
    scansSuccessCount?: number;
    coachIds?: Types.ObjectId[];
  }) => {
    const bookedMembers = Array.from({ length: opts.bookedCount }, () => ({
      uid: new Types.ObjectId(),
      method: "Test Package",
    }));

    const successCount = opts.scansSuccessCount ?? opts.bookedCount;
    const scans = Array.from({ length: successCount }, () => ({
      uid: new Types.ObjectId(),
      scanTime: new Date(),
      method: "QR",
      status: true, // SUCCESS
    }));

    return {
      _id: new Types.ObjectId(mockScid),
      startTime: opts.startTime,
      endTime: opts.endTime,
      bookedMembers,
      scans,
      coachId: opts.coachIds ?? [mockCoachDocId],
      attendanceConfirmation: undefined as any,
      save: jest.fn().mockResolvedValue(true),
    };
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("CoachService.confirmAttendance", () => {
    it("rejects confirmation before halfway point with SESSION_NOT_HALFWAY", async () => {
      const now = Date.now();
      // Class starts now, ends in 60 mins -> midpoint is +30 mins
      const startTime = new Date(now);
      const endTime = new Date(now + 60 * 60 * 1000);

      const mockSession = createMockSession({ startTime, endTime, bookedCount: 5 });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      await expect(
        CoachService.confirmAttendance(mockCoachDocId, mockScid, { confirmedCount: 5 })
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects confirmation if coach is not assigned to the class with COACH_NOT_ASSIGNED", async () => {
      const now = Date.now();
      // Class started 45 mins ago, ends in 15 mins -> past halfway
      const startTime = new Date(now - 45 * 60 * 1000);
      const endTime = new Date(now + 15 * 60 * 1000);

      const mockSession = createMockSession({
        startTime,
        endTime,
        bookedCount: 5,
        coachIds: [mockOtherCoachDocId],
      });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      await expect(
        CoachService.confirmAttendance(mockCoachDocId, mockScid, { confirmedCount: 5 })
      ).rejects.toThrow(ForbiddenError);
    });

    it("detects missing place when confirmed count is less than scanned-in count", async () => {
      const now = Date.now();
      // Class started 40 mins ago, ends in 20 mins -> halfway was 10 mins ago
      const startTime = new Date(now - 40 * 60 * 1000);
      const endTime = new Date(now + 20 * 60 * 1000);

      // 5 booked, 5 scanned in, but coach counts only 4 physically present
      const mockSession = createMockSession({ startTime, endTime, bookedCount: 5, scansSuccessCount: 5 });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      const mockIo = { emit: jest.fn() };
      await CoachService.confirmAttendance(
        mockCoachDocId,
        mockScid,
        { confirmedCount: 4, notes: "One member absent" },
        mockIo
      );

      expect(mockSession.save).toHaveBeenCalled();
      expect(mockSession.attendanceConfirmation.confirmed).toBe(true);
      expect(mockSession.attendanceConfirmation.confirmedCount).toBe(4);
      expect(mockSession.attendanceConfirmation.hasMissingPlace).toBe(true); // 4 < 5 (scans)
      expect(mockSession.attendanceConfirmation.notes).toBe("One member absent");

      expect(mockIo.emit).toHaveBeenCalledWith(
        "ATTENDANCE-CONFIRMED",
        expect.objectContaining({ scheduledClassId: mockScid })
      );
      expect(mockIo.emit).toHaveBeenCalledWith("SUCCESS-SCAN");
    });

    it("marks hasMissingPlace false when confirmed count matches scanned-in count", async () => {
      const now = Date.now();
      const startTime = new Date(now - 40 * 60 * 1000);
      const endTime = new Date(now + 20 * 60 * 1000);

      // 5 booked, 5 scanned in, 5 confirmed physically
      const mockSession = createMockSession({ startTime, endTime, bookedCount: 5, scansSuccessCount: 5 });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      await CoachService.confirmAttendance(
        mockCoachDocId,
        mockScid,
        { confirmedCount: 5 }
      );

      expect(mockSession.attendanceConfirmation.hasMissingPlace).toBe(false);
    });

    it("does NOT flag missing place when headcount matches scans even if fewer than bookings", async () => {
      const now = Date.now();
      const startTime = new Date(now - 40 * 60 * 1000);
      const endTime = new Date(now + 20 * 60 * 1000);

      // 5 booked, only 3 actually scanned in, coach counts 3 physically -> no discrepancy
      const mockSession = createMockSession({ startTime, endTime, bookedCount: 5, scansSuccessCount: 3 });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      await CoachService.confirmAttendance(
        mockCoachDocId,
        mockScid,
        { confirmedCount: 3 }
      );

      expect(mockSession.attendanceConfirmation.hasMissingPlace).toBe(false);
    });

    it("allows explicit override of hasMissingPlace", async () => {
      const now = Date.now();
      const startTime = new Date(now - 40 * 60 * 1000);
      const endTime = new Date(now + 20 * 60 * 1000);

      const mockSession = createMockSession({ startTime, endTime, bookedCount: 5, scansSuccessCount: 5 });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);

      await CoachService.confirmAttendance(
        mockCoachDocId,
        mockScid,
        { confirmedCount: 5, hasMissingPlace: true }
      );

      expect(mockSession.attendanceConfirmation.hasMissingPlace).toBe(true);
    });
  });

  describe("SchedulerService.confirmAttendance", () => {
    it("detects missing place when confirmed count is less than scanned-in count", async () => {
      // 3 scanned in, admin confirms only 2 physically present -> missing place
      const mockSession = createMockSession({
        startTime: new Date(),
        endTime: new Date(),
        bookedCount: 3,
        scansSuccessCount: 3,
      });
      (ScheduledClass.findById as jest.Mock).mockResolvedValue(mockSession);
      jest.spyOn(SchedulerService, "assertSessionAtLocation").mockResolvedValue(undefined as any);

      const mockIo = { emit: jest.fn() };
      await SchedulerService.confirmAttendance(
        mockScid,
        { confirmedCount: 2 },
        mockIo
      );

      expect(mockSession.save).toHaveBeenCalled();
      expect(mockSession.attendanceConfirmation.confirmed).toBe(true);
      expect(mockSession.attendanceConfirmation.confirmedCount).toBe(2);
      expect(mockSession.attendanceConfirmation.hasMissingPlace).toBe(true); // 2 < 3 (scans)
    });
  });
});
