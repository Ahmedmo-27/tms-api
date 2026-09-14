import { Types } from "mongoose";
import { BookingsService } from "./bookings-service";
import NonUserBooking from "../models/nonUserBookings";
import ScheduledClass from "../models/scheduledClass";

jest.mock("../models/nonUserBookings");
jest.mock("../models/scheduledClass");
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn((fn: any) => fn({})),
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("BookingsService Non-User Walkin and Bookings", () => {
  const scid1 = new Types.ObjectId();
  const scid2 = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getNonUserBookings", () => {
    it("queries ScheduledClass by date and filters NonUserBooking by matching scids", async () => {
      const mockScheduledClasses = [{ _id: scid1 }, { _id: scid2 }];
      (ScheduledClass.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockScheduledClasses),
        }),
      });

      const mockBookings = [
        { _id: new Types.ObjectId(), name: "John Doe", scid: scid1, status: "PAID" },
        { _id: new Types.ObjectId(), name: "Jane Doe", scid: scid2, status: "ATTENDED" },
      ];
      (NonUserBooking.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockBookings),
      });

      const result = await BookingsService.getNonUserBookings(
        new Date("2026-09-14"),
        new Date("2026-09-14"),
      );

      expect(ScheduledClass.find).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: expect.any(Object),
        })
      );
      expect(NonUserBooking.find).toHaveBeenCalledWith({
        scid: { $in: [scid1, scid2] },
      });
      expect(result).toEqual(mockBookings);
    });

    it("returns empty array if no scheduled classes found for the given date", async () => {
      (ScheduledClass.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await BookingsService.getNonUserBookings(new Date("2026-09-14"));

      expect(result).toEqual([]);
      expect(NonUserBooking.find).not.toHaveBeenCalled();
    });

    it("queries directly by scid when no date or location filter is provided", async () => {
      const targetScid = new Types.ObjectId().toString();
      const mockBookings = [{ _id: new Types.ObjectId(), name: "John", scid: new Types.ObjectId(targetScid) }];
      (NonUserBooking.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockBookings),
      });

      const result = await BookingsService.getNonUserBookings(undefined, undefined, targetScid);

      expect(ScheduledClass.find).not.toHaveBeenCalled();
      expect(NonUserBooking.find).toHaveBeenCalledWith({
        scid: new Types.ObjectId(targetScid),
      });
      expect(result).toEqual(mockBookings);
    });
  });

  describe("addNonUserBooking", () => {
    it("creates booking and books non-user in scheduled class without pre-incrementing availableSlots", async () => {
      const scid = new Types.ObjectId().toString();
      const scheduledClassDoc = {
        _id: new Types.ObjectId(scid),
        availableSlots: 5,
        cid: { allowDropIn: true },
      };

      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(scheduledClassDoc),
      });

      const mockBooking = { _id: new Types.ObjectId(), name: "WalkIn User", scid, phoneNumber: "01000000000" };
      (NonUserBooking.addBooking as jest.Mock).mockResolvedValue(mockBooking);
      (ScheduledClass.bookNonUser as jest.Mock).mockResolvedValue(undefined);

      const result = await BookingsService.addNonUserBooking("WalkIn User", "01000000000", scid);

      expect(NonUserBooking.addBooking).toHaveBeenCalledWith(scid, "WalkIn User", "01000000000", expect.anything());
      expect(ScheduledClass.bookNonUser).toHaveBeenCalledWith(scid, expect.anything(), true);
      expect(result).toEqual(mockBooking);
    });
  });
});
