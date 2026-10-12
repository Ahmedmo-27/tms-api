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

  describe("recordNonUserPayment", () => {
    it("updates booking with PAID status when paymentMethod is DEDUCTED", async () => {
      const bookingId = new Types.ObjectId().toString();
      const mockBooking = {
        _id: new Types.ObjectId(bookingId),
        name: "WalkIn User",
        phoneNumber: "01000000000",
        status: "ATTENDED",
        scid: scid1,
      };

      (NonUserBooking.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(mockBooking),
      });

      const mockClass = {
        _id: scid1,
        cid: { price: 300 },
        locationId: new Types.ObjectId(),
      };
      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(mockClass),
        }),
      });

      const paymentId = new Types.ObjectId();
      const mockPayment = { _id: paymentId, paymentMethod: "DEDUCTED", paymentTime: new Date() };
      const { PaymentsService } = require("./payments-service");
      jest.spyOn(PaymentsService, "savePayment").mockResolvedValue(mockPayment as any);

      (NonUserBooking.recordPayment as jest.Mock).mockResolvedValue({
        ...mockBooking,
        status: "PAID",
        paymentId,
      });

      const result = await BookingsService.recordNonUserPayment(
        bookingId,
        "DEDUCTED",
      );

      expect(NonUserBooking.recordPayment).toHaveBeenCalledWith(
        bookingId,
        paymentId.toString(),
        expect.anything(),
        "PAID"
      );
      expect(result.status).toBe("PAID");
    });

    it("updates booking with PAID status when paymentMethod is VISA, CASH, or VALU", async () => {
      const bookingId = new Types.ObjectId().toString();
      const mockBooking = {
        _id: new Types.ObjectId(bookingId),
        name: "WalkIn User",
        phoneNumber: "01000000000",
        status: "ATTENDED",
        scid: scid1,
      };

      (NonUserBooking.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(mockBooking),
      });

      const mockClass = {
        _id: scid1,
        cid: { price: 300 },
        locationId: new Types.ObjectId(),
      };
      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(mockClass),
        }),
      });

      const paymentId = new Types.ObjectId();
      const mockPayment = { _id: paymentId, paymentMethod: "VISA", paymentTime: new Date() };
      const { PaymentsService } = require("./payments-service");
      jest.spyOn(PaymentsService, "savePayment").mockResolvedValue(mockPayment as any);

      (NonUserBooking.recordPayment as jest.Mock).mockResolvedValue({
        ...mockBooking,
        status: "PAID",
        paymentId,
      });

      const result = await BookingsService.recordNonUserPayment(
        bookingId,
        "VISA",
      );

      expect(NonUserBooking.recordPayment).toHaveBeenCalledWith(
        bookingId,
        paymentId.toString(),
        expect.anything(),
        "PAID"
      );
      expect(result.status).toBe("PAID");
    });

    it("throws BadRequestError if paymentMethod is FOC", async () => {
      const bookingId = new Types.ObjectId().toString();
      const mockBooking = {
        _id: new Types.ObjectId(bookingId),
        name: "WalkIn User",
        phoneNumber: "01000000000",
        status: "ATTENDED",
        scid: scid1,
      };

      (NonUserBooking.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(mockBooking),
      });

      await expect(
        BookingsService.recordNonUserPayment(bookingId, "FOC")
      ).rejects.toThrow("FOC entries cannot record a payment");
    });
  });

  describe("recordNonUserFoc", () => {
    it("records FOC status without creating a payment record", async () => {
      const bookingId = new Types.ObjectId().toString();
      const mockBooking = {
        _id: new Types.ObjectId(bookingId),
        name: "FOC Walk-in Guest",
        status: "BOOKED",
        scid: scid1,
      };

      (NonUserBooking.findById as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue(mockBooking),
      });

      const mockClass = {
        _id: scid1,
        cid: { price: 300 },
      };
      (ScheduledClass.findById as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(mockClass),
        }),
      });

      (NonUserBooking.recordFoc as jest.Mock).mockResolvedValue({
        ...mockBooking,
        status: "FOC",
        attendanceTime: new Date(),
      });

      const result = await BookingsService.recordNonUserFoc(bookingId);

      expect(NonUserBooking.recordFoc).toHaveBeenCalledWith(
        bookingId,
        expect.anything()
      );
      expect(result.status).toBe("FOC");
      expect((result as any).paymentId).toBeUndefined();
    });
  });
});
