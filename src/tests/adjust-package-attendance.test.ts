import { Types } from "mongoose";
import { adjustMemberPackageClasses } from "../controllers/admin/package-controller";
import Member from "../models/member";
import Package from "../models/package";
import DailyAttendance from "../models/dailyAttendance";

jest.mock("../models/member");
jest.mock("../models/package");
jest.mock("../models/dailyAttendance");
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn().mockImplementation(async (callback) => {
    return callback(null);
  }),
}));

describe("adjustMemberPackageClasses - PT Attendance & Scans", () => {
  const uid = new Types.ObjectId().toString();
  const pkgId = new Types.ObjectId().toString();
  const coachId = new Types.ObjectId().toString();
  const startDate = new Date("2026-09-01T10:00:00.000Z");

  let mockRes: any;
  let mockReq: any;
  let mockNext: any;
  let ioMock: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ioMock = { emit: jest.fn() };
    mockNext = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it("records PT attendance and emits SUCCESS-SCAN when reason starts with Completed session on PT package", async () => {
    const mockPkg = {
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: startDate,
      remainingClasses: 5,
      status: "ACTIVE",
    };

    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      packages: [mockPkg],
    });
    (Member.editPackageClasses as jest.Mock).mockResolvedValue(undefined);
    (Member.pushAdjustmentRecord as jest.Mock).mockResolvedValue(undefined);
    (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(pkgId),
      name: "10 PT with Coach",
      category: "PERSONAL_TRAINING",
      coachId: new Types.ObjectId(coachId),
    });

    const sessionDate = new Date().toISOString();

    mockReq = {
      body: {
        uid,
        pkgId,
        pkgStartDate: startDate.toISOString(),
        amount: 1,
        type: "DEDUCT",
        reason: "Completed session. Great work",
        sessionDate,
      },
      app: {
        get: jest.fn().mockReturnValue(ioMock),
      },
    };

    await adjustMemberPackageClasses(mockReq, mockRes, mockNext);

    expect(Member.editPackageClasses).toHaveBeenCalledWith(uid, pkgId, startDate.toISOString(), 4);
    expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
      uid,
      "10 PT with Coach",
      null,
      "SUCCESS",
      ioMock,
      undefined,
      coachId,
      new Date(sessionDate)
    );
    expect(ioMock.emit).toHaveBeenCalledWith("SUCCESS-SCAN", expect.objectContaining({
      code: "PT_CLASS_ATTENDED",
      memberId: uid,
      coach: "10 PT with Coach",
    }));
  });

  it("records PT attendance but does NOT emit SUCCESS-SCAN when sessionDate is in the past", async () => {
    const mockPkg = {
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: startDate,
      remainingClasses: 5,
      status: "ACTIVE",
    };

    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      packages: [mockPkg],
    });
    (Member.editPackageClasses as jest.Mock).mockResolvedValue(undefined);
    (Member.pushAdjustmentRecord as jest.Mock).mockResolvedValue(undefined);
    (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(pkgId),
      name: "10 PT with Coach",
      category: "PERSONAL_TRAINING",
      coachId: new Types.ObjectId(coachId),
    });

    const pastSessionDate = "2026-09-23T12:00:00.000Z";

    mockReq = {
      body: {
        uid,
        pkgId,
        pkgStartDate: startDate.toISOString(),
        amount: 1,
        type: "DEDUCT",
        reason: "Completed session. Great work",
        sessionDate: pastSessionDate,
      },
      app: {
        get: jest.fn().mockReturnValue(ioMock),
      },
    };

    await adjustMemberPackageClasses(mockReq, mockRes, mockNext);

    expect(Member.editPackageClasses).toHaveBeenCalledWith(uid, pkgId, startDate.toISOString(), 4);
    expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
      uid,
      "10 PT with Coach",
      null,
      "SUCCESS",
      ioMock,
      undefined,
      coachId,
      new Date(pastSessionDate)
    );
    // Crucial: socket SUCCESS-SCAN must NOT be emitted for past sessions
    expect(ioMock.emit).not.toHaveBeenCalled();
  });

  it("does NOT record PT attendance when reason is No-show or administrative", async () => {
    const mockPkg = {
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: startDate,
      remainingClasses: 5,
      status: "ACTIVE",
    };

    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      packages: [mockPkg],
    });
    (Member.editPackageClasses as jest.Mock).mockResolvedValue(undefined);
    (Member.pushAdjustmentRecord as jest.Mock).mockResolvedValue(undefined);

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(pkgId),
      name: "10 PT with Coach",
      category: "PERSONAL_TRAINING",
      coachId: new Types.ObjectId(coachId),
    });

    mockReq = {
      body: {
        uid,
        pkgId,
        pkgStartDate: startDate.toISOString(),
        amount: 1,
        type: "DEDUCT",
        reason: "No-show. Client didn't appear",
      },
      app: {
        get: jest.fn().mockReturnValue(ioMock),
      },
    };

    await adjustMemberPackageClasses(mockReq, mockRes, mockNext);

    expect(Member.editPackageClasses).toHaveBeenCalledWith(uid, pkgId, startDate.toISOString(), 4);
    expect(DailyAttendance.recordPtAttendance).not.toHaveBeenCalled();
    expect(ioMock.emit).not.toHaveBeenCalled();
  });

  it("does NOT record PT attendance when type is ADD", async () => {
    const mockPkg = {
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: startDate,
      remainingClasses: 5,
      status: "ACTIVE",
    };

    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      packages: [mockPkg],
    });
    (Member.editPackageClasses as jest.Mock).mockResolvedValue(undefined);
    (Member.pushAdjustmentRecord as jest.Mock).mockResolvedValue(undefined);

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(pkgId),
      name: "10 PT with Coach",
      category: "PERSONAL_TRAINING",
      coachId: new Types.ObjectId(coachId),
    });

    mockReq = {
      body: {
        uid,
        pkgId,
        pkgStartDate: startDate.toISOString(),
        amount: 1,
        type: "ADD",
        reason: "Compensation class",
      },
      app: {
        get: jest.fn().mockReturnValue(ioMock),
      },
    };

    await adjustMemberPackageClasses(mockReq, mockRes, mockNext);

    expect(Member.editPackageClasses).toHaveBeenCalledWith(uid, pkgId, startDate.toISOString(), 6);
    expect(DailyAttendance.recordPtAttendance).not.toHaveBeenCalled();
  });

  it("uses exact deduction time when sessionDate is date-only (avoiding 3:00 AM UTC midnight)", async () => {
    const mockPkg = {
      pkgId: new Types.ObjectId(pkgId),
      pkgStartDate: startDate,
      remainingClasses: 5,
      status: "ACTIVE",
    };

    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      packages: [mockPkg],
    });
    (Member.editPackageClasses as jest.Mock).mockResolvedValue(undefined);
    (Member.pushAdjustmentRecord as jest.Mock).mockResolvedValue(undefined);
    (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(pkgId),
      name: "10 PT with Coach",
      category: "PERSONAL_TRAINING",
      coachId: new Types.ObjectId(coachId),
    });

    // Pass a date-only string like "2026-10-03" (from an HTML date input)
    const sessionDate = "2026-10-03";

    mockReq = {
      body: {
        uid,
        pkgId,
        pkgStartDate: startDate.toISOString(),
        amount: 1,
        type: "DEDUCT",
        reason: "Completed session. Great work",
        sessionDate,
      },
      app: {
        get: jest.fn().mockReturnValue(ioMock),
      },
    };

    await adjustMemberPackageClasses(mockReq, mockRes, mockNext);

    expect(DailyAttendance.recordPtAttendance).toHaveBeenCalled();
    const recordedAtDate: Date = (DailyAttendance.recordPtAttendance as jest.Mock).mock.calls[0][7];
    // Check that it does NOT have UTC hours 0 and UTC minutes 0 (which produces 3:00 AM in Cairo)
    const is3amUtc = recordedAtDate.getUTCHours() === 0 && recordedAtDate.getUTCMinutes() === 0;
    expect(is3amUtc).toBe(false);
  });
});
