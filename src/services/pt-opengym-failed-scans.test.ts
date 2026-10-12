import { Types } from "mongoose";
import { Server } from "http";
import { BookingsService } from "./bookings-service";
import { ScanAdminService } from "./scan-admin-service";
import Member from "../models/member";
import Package from "../models/package";
import Location from "../models/location";
import DailyAttendance from "../models/dailyAttendance";
import { ForbiddenError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { removeFailedScan } from "../controllers/admin/class-controller";

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

describe("PT and Open Gym Failed Scans & Deletion", () => {
  const uid = new Types.ObjectId().toString();
  const coachId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();
  const dayId = new Types.ObjectId().toString();
  const rowId = new Types.ObjectId().toString();
  const io = { emit: jest.fn() } as unknown as Server;
  const mockSession = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn(mockSession)
    );
    (Location.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: locationId }),
    });
  });

  describe("BookingsService.recordPtAttendance failed scans", () => {
    const ptPkgId = new Types.ObjectId().toString();

    beforeEach(() => {
      (Package.find as jest.Mock).mockResolvedValue([
        {
          _id: new Types.ObjectId(ptPkgId),
          name: "10 PT Sessions",
          coachId: new Types.ObjectId(coachId),
        },
      ]);
    });

    it("records FAILED attendance with 'Package Frozen' outside transaction when member package is frozen", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          uid: { name: "Ahmed Test" },
          packages: [
            {
              pkgId: new Types.ObjectId(ptPkgId),
              status: "FROZEN",
            },
          ],
        }),
      });

      (Member.recordPtAttendance as jest.Mock).mockRejectedValue(
        new ForbiddenError("PACKAGE_FROZEN", "Your package is currently frozen.")
      );
      (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordPtAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "PACKAGE_FROZEN",
      });

      // Crucial: session must be undefined (outside the aborted transaction)
      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "Package Frozen",
        undefined,
        "FAILED",
        io,
        locationId,
        coachId
      );
    });

    it("records FAILED attendance with 'Package Expired' outside transaction when member package is expired", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          uid: { name: "Ahmed Test" },
          packages: [
            {
              pkgId: new Types.ObjectId(ptPkgId),
              status: "EXPIRED",
            },
          ],
        }),
      });

      (Member.recordPtAttendance as jest.Mock).mockRejectedValue(
        new ForbiddenError("PACKAGE_EXPIRED", "Your package has expired.")
      );
      (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordPtAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "PACKAGE_EXPIRED",
      });

      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "Package Expired",
        undefined,
        "FAILED",
        io,
        locationId,
        coachId
      );
    });

    it("records FAILED attendance with 'No Active Package' when member has no active package", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          uid: { name: "Ahmed Test" },
          packages: [],
        }),
      });

      (Member.recordPtAttendance as jest.Mock).mockRejectedValue(
        new ForbiddenError("NO_ACTIVE_PACKAGE_FOUND", "No active PT package found.")
      );
      (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordPtAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "NO_ACTIVE_PACKAGE_FOUND",
      });

      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "No Active Package",
        undefined,
        "FAILED",
        io,
        locationId,
        undefined
      );
    });

    it("records FAILED attendance with 'No Active Package' when recordPtAttendance returns null", async () => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          uid: { name: "Ahmed Test" },
          packages: [],
        }),
      });

      (Member.recordPtAttendance as jest.Mock).mockResolvedValue(null);
      (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordPtAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "NO_ACTIVE_PACKAGE_FOUND",
      });

      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "No Active Package",
        undefined,
        "FAILED",
        io,
        locationId,
        undefined
      );
    });
  });

  describe("BookingsService.recordOpenGymAttendance failed scans", () => {
    beforeEach(() => {
      (Member.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          uid: { name: "Test Member" },
          bookings: [],
        }),
      });
      (Package.getSpaceWalkPackageIds as jest.Mock).mockResolvedValue([
        new Types.ObjectId().toString(),
      ]);
      (Location.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: locationId }),
      });
      (DailyAttendance.hasSuccessfulOpenGymToday as jest.Mock).mockResolvedValue(false);
    });

    it("records FAILED attendance with 'No Access At Location' outside transaction when pid is NO_ACCESS_AT_LOCATION", async () => {
      (Member.recordSpaceWalkAttendance as jest.Mock).mockResolvedValue(
        "NO_ACCESS_AT_LOCATION"
      );
      (DailyAttendance.recordOpenGymAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordOpenGymAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "NO_ACCESS_AT_LOCATION",
      });

      expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledWith(
        uid,
        "No Access At Location",
        undefined,
        "FAILED",
        io,
        locationId
      );
    });

    it("records FAILED attendance with 'No Active Package' outside transaction when pid is null", async () => {
      (Member.recordSpaceWalkAttendance as jest.Mock).mockResolvedValue(null);
      (DailyAttendance.recordOpenGymAttendance as jest.Mock).mockResolvedValue(undefined);

      await expect(
        BookingsService.recordOpenGymAttendance(uid, io, locationId)
      ).rejects.toMatchObject({
        code: "NO_ACTIVE_PACKAGE_FOUND",
      });

      expect(DailyAttendance.recordOpenGymAttendance).toHaveBeenCalledWith(
        uid,
        "No Active Package",
        undefined,
        "FAILED",
        io,
        locationId
      );
    });
  });

  describe("ScanAdminService.deleteScanRow for failed scans", () => {
    it("deletes a FAILED PT scan row from DailyAttendance without refunding sessions", async () => {
      const failedRow = {
        _id: new Types.ObjectId(rowId),
        uid: new Types.ObjectId(uid),
        method: "Package Expired",
        status: "FAILED",
        time: new Date(),
      };
      const ptArray: any = [failedRow];
      ptArray.id = jest.fn((id: string) =>
        id === rowId ? failedRow : null
      );
      ptArray.pull = jest.fn();

      const dayDoc = {
        _id: new Types.ObjectId(dayId),
        ptAttendance: ptArray,
        save: jest.fn().mockResolvedValue(undefined),
      };

      (DailyAttendance.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(dayDoc),
      });

      await ScanAdminService.deleteScanRow({
        source: "pt",
        parentId: dayId,
        rowId,
      });

      expect(ptArray.pull).toHaveBeenCalledWith(expect.objectContaining({ _id: failedRow._id }));
      expect(dayDoc.save).toHaveBeenCalled();
      // Ensure member packages were NOT touched
      expect(Member.findOne).not.toHaveBeenCalled();
    });

    it("deletes a FAILED Open Gym scan row from DailyAttendance without refunding sessions", async () => {
      const failedRow = {
        _id: new Types.ObjectId(rowId),
        uid: new Types.ObjectId(uid),
        method: "No Access At Location",
        status: "FAILED",
        time: new Date(),
      };
      const openGymArray: any = [failedRow];
      openGymArray.id = jest.fn((id: string) =>
        id === rowId ? failedRow : null
      );
      openGymArray.pull = jest.fn();

      const dayDoc = {
        _id: new Types.ObjectId(dayId),
        openGymAttendance: openGymArray,
        save: jest.fn().mockResolvedValue(undefined),
      };

      (DailyAttendance.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(dayDoc),
      });

      await ScanAdminService.deleteScanRow({
        source: "open-gym",
        parentId: dayId,
        rowId,
      });

      expect(openGymArray.pull).toHaveBeenCalledWith(expect.objectContaining({ _id: failedRow._id }));
      expect(dayDoc.save).toHaveBeenCalled();
      expect(Member.findOne).not.toHaveBeenCalled();
    });
  });

  describe("removeFailedScan controller endpoint", () => {
    it("deletes failed PT scan and emits SUCCESS-SCAN socket event", async () => {
      const deleteScanRowSpy = jest
        .spyOn(ScanAdminService, "deleteScanRow")
        .mockResolvedValueOnce(undefined);

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: { source: "pt", parentId: dayId, rowId },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await removeFailedScan(req, res, jest.fn());

      expect(deleteScanRowSpy).toHaveBeenCalledWith(
        { source: "pt", parentId: dayId, rowId },
        { restoreSession: false }
      );
      expect(mockIo.emit).toHaveBeenCalledWith("SUCCESS-SCAN");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Failed scan removed" })
      );

      deleteScanRowSpy.mockRestore();
    });

    it("deletes failed Open Gym scan and emits SUCCESS-SCAN socket event", async () => {
      const deleteScanRowSpy = jest
        .spyOn(ScanAdminService, "deleteScanRow")
        .mockResolvedValueOnce(undefined);

      const mockIo = { emit: jest.fn() };
      const req: any = {
        body: { source: "open-gym", parentId: dayId, rowId },
        app: { get: jest.fn().mockReturnValue(mockIo) },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await removeFailedScan(req, res, jest.fn());

      expect(deleteScanRowSpy).toHaveBeenCalledWith(
        { source: "open-gym", parentId: dayId, rowId },
        { restoreSession: false }
      );
      expect(mockIo.emit).toHaveBeenCalledWith("SUCCESS-SCAN");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Failed scan removed" })
      );

      deleteScanRowSpy.mockRestore();
    });
  });
});
