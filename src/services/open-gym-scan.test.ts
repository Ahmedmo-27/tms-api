import { Types } from "mongoose";
import { Server } from "http";
import { BookingsService } from "./bookings-service";
import Member from "../models/member";
import Package from "../models/package";
import Location from "../models/location";
import DailyAttendance from "../models/dailyAttendance";
import { BadRequestError, ForbiddenError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";

jest.mock("../models/member");
jest.mock("../models/package");
jest.mock("../models/location");
jest.mock("../models/dailyAttendance");
jest.mock("../utils/transaction");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("BookingsService branch open gym scans", () => {
  const uid = new Types.ObjectId().toString();
  const branchA = new Types.ObjectId().toString();
  const branchB = new Types.ObjectId().toString();
  const missingBranch = new Types.ObjectId().toString();
  const io = { emit: jest.fn() } as unknown as Server;
  const mockSession = {} as any;

  const memberDoc = {
    uid: { name: "Test Member" },
    bookings: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn(mockSession),
    );
    (Member.findOne as jest.Mock).mockImplementation(() => ({
      populate: jest.fn().mockResolvedValue(memberDoc),
    }));
    (Package.getSpaceWalkPackageIds as jest.Mock).mockResolvedValue([
      new Types.ObjectId().toString(),
    ]);
    (DailyAttendance.hasSuccessfulOpenGymToday as jest.Mock).mockResolvedValue(
      false,
    );
  });

  it("records successful branch open gym attendance with locationId", async () => {
    (Location.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: branchA }),
    });
    (Member.recordSpaceWalkAttendance as jest.Mock).mockResolvedValue(
      new Types.ObjectId().toString(),
    );
    (Package.findById as jest.Mock).mockResolvedValue({ name: "Open Gym" });
    (DailyAttendance.recordOpenGymAttendance as jest.Mock).mockResolvedValue(
      undefined,
    );

    await BookingsService.recordOpenGymAttendance(uid, io, branchA);

    expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledWith(
      uid,
      "Open Gym",
      mockSession,
      "SUCCESS",
      io,
      branchA,
    );
    expect(io.emit).toHaveBeenCalledWith(
      "SUCCESS-SCAN",
      expect.objectContaining({
        code: "OPEN_GYM_CLASS_ATTENDED",
        locationId: branchA,
      }),
    );
  });

  it("fails for wrong-branch package access without treating it as legacy open gym", async () => {
    (Location.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: branchB }),
    });
    (Member.recordSpaceWalkAttendance as jest.Mock).mockResolvedValue(
      "NO_ACCESS_AT_LOCATION",
    );

    await expect(
      BookingsService.recordOpenGymAttendance(uid, io, branchB),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledWith(
      uid,
      "No Access At Location",
      mockSession,
      "FAILED",
      io,
      branchB,
    );
  });

  it("rejects nonexistent branch locations without creating attendance", async () => {
    (Location.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });

    await expect(
      BookingsService.recordOpenGymAttendance(uid, io, missingBranch),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(DailyAttendance.recordOpenGymAttendance).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledWith(
      "FAILED-SCAN",
      expect.objectContaining({ code: "INVALID_LOCATION" }),
    );
  });

  it("rejects malformed branch ids without creating attendance", async () => {
    await expect(
      BookingsService.recordOpenGymAttendance(uid, io, "bad-format"),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(Location.findById).not.toHaveBeenCalled();
    expect(DailyAttendance.recordOpenGymAttendance).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledWith(
      "FAILED-SCAN",
      expect.objectContaining({ code: "INVALID_LOCATION" }),
    );
  });

  it("rejects legacy open gym when multiple branches exist and no default is configured", async () => {
    const openGymLocation = await import("../utils/open-gym-location");
    jest
      .spyOn(openGymLocation, "resolveLegacyOpenGymLocationId")
      .mockResolvedValue(null);

    await expect(
      BookingsService.recordLegacyOpenGymAttendance(uid, io),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(DailyAttendance.recordOpenGymAttendance).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledWith(
      "FAILED-SCAN",
      expect.objectContaining({ code: "LEGACY_OPEN_GYM_UNAVAILABLE" }),
    );
  });
});
