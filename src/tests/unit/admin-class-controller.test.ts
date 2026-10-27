import { Request, Response } from "express";
import { Types } from "mongoose";
import Class from "../../models/class";
import ScheduledClass from "../../models/scheduledClass";
import Location from "../../models/location";
import { updateClass, deleteClass } from "../../controllers/admin/class-controller";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/ApiError";
import { clearFinanceCache } from "../../services/finance-service";

jest.mock("../../models/class");
jest.mock("../../models/scheduledClass");
jest.mock("../../models/location");
jest.mock("../../services/finance-service", () => ({
  clearFinanceCache: jest.fn(),
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
    });
    fn(req, res, next);
  });
}

describe("Admin Class Controller - updateClass & deleteClass", () => {
  const classId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("updateClass", () => {
    it("allows updating class price instantaneously even if scheduled classes exist", async () => {
      // Mock that scheduled classes DO exist for this class
      (ScheduledClass.find as jest.Mock).mockResolvedValue([
        { _id: new Types.ObjectId(), cid: new Types.ObjectId(classId) },
        { _id: new Types.ObjectId(), cid: new Types.ObjectId(classId) },
      ]);

      const mockUpdatedClass = {
        _id: new Types.ObjectId(classId),
        title: "Mat Pilates",
        price: 550,
        category: "STUDIO",
        locations: [{ _id: new Types.ObjectId(locationId), branchName: "New Cairo", location: "New Cairo" }],
        toObject: () => ({
          _id: classId,
          title: "Mat Pilates",
          price: 550,
          category: "STUDIO",
          locations: [{ _id: locationId, branchName: "New Cairo", location: "New Cairo" }],
        }),
      };

      (Class.findByIdAndUpdate as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUpdatedClass),
      });

      const req: any = {
        params: { cid: classId },
        body: {
          title: "Mat Pilates",
          price: "550",
          category: "STUDIO",
          locations: [locationId],
        },
      };

      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await invokeController(updateClass, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Class Updated!",
          data: expect.objectContaining({
            price: 550,
            title: "Mat Pilates",
          }),
        })
      );
      expect(Class.findByIdAndUpdate).toHaveBeenCalledWith(
        classId,
        expect.objectContaining({
          price: 550,
          title: "Mat Pilates",
          category: "STUDIO",
        }),
        { new: true }
      );
      expect(clearFinanceCache).toHaveBeenCalled();
    });

    it("allows updating class defaultDuration", async () => {
      const mockUpdatedClass = {
        _id: new Types.ObjectId(classId),
        title: "Mat Pilates",
        price: 550,
        defaultDuration: 75,
        toObject: () => ({
          _id: classId,
          title: "Mat Pilates",
          price: 550,
          defaultDuration: 75,
        }),
      };

      (Class.findByIdAndUpdate as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockUpdatedClass),
      });

      const req: any = {
        params: { cid: classId },
        body: {
          defaultDuration: 75,
        },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await invokeController(updateClass, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(Class.findByIdAndUpdate).toHaveBeenCalledWith(
        classId,
        expect.objectContaining({
          defaultDuration: 75,
        }),
        { new: true }
      );
    });

    it("rejects invalid defaultDuration values", async () => {
      const req: any = {
        params: { cid: classId },
        body: {
          defaultDuration: -10,
        },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await expect(invokeController(updateClass, req, res)).rejects.toThrow(BadRequestError);
    });

    it("rejects invalid price formats", async () => {
      const req: any = {
        params: { cid: classId },
        body: {
          price: "not-a-number",
        },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(updateClass, req, res)).rejects.toThrow(BadRequestError);
    });

    it("throws NotFoundError if class does not exist", async () => {
      (Class.findByIdAndUpdate as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      const req: any = {
        params: { cid: classId },
        body: {
          price: 600,
        },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(updateClass, req, res)).rejects.toThrow(NotFoundError);
    });
  });

  describe("deleteClass", () => {
    it("throws ConflictError and prevents deletion if scheduled classes exist", async () => {
      (ScheduledClass.find as jest.Mock).mockResolvedValue([
        { _id: new Types.ObjectId(), cid: new Types.ObjectId(classId) },
      ]);

      const req: any = {
        params: { cid: classId },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await expect(invokeController(deleteClass, req, res)).rejects.toThrow(ConflictError);
      // Verify Class.findByIdAndDelete was NOT called before or after
      expect(Class.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it("deletes class successfully if no scheduled classes exist", async () => {
      (ScheduledClass.find as jest.Mock).mockResolvedValue([]);
      const mockDeletedClass = { _id: classId, title: "Old Class" };
      (Class.findByIdAndDelete as jest.Mock).mockResolvedValue(mockDeletedClass);

      const req: any = {
        params: { cid: classId },
      };

      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await invokeController(deleteClass, req, res);

      expect(Class.findByIdAndDelete).toHaveBeenCalledWith(classId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Class Deleted!",
        })
      );
      expect(clearFinanceCache).toHaveBeenCalled();
    });
  });
});
