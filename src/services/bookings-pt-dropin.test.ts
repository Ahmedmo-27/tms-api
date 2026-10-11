import { Types } from "mongoose";
import { Server } from "http";
import { BookingsService, DEFAULT_PT_DROP_IN_PRICE } from "./bookings-service";
import Member from "../models/member";
import User from "../models/user";
import Class from "../models/class";
import Coach from "../models/coach";
import Location from "../models/location";
import DailyAttendance from "../models/dailyAttendance";
import { PaymentsService } from "./payments-service";
import { ConflictError, NotFoundError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";

jest.mock("../models/member");
jest.mock("../models/user");
jest.mock("../models/class");
jest.mock("../models/coach");
jest.mock("../models/location");
jest.mock("../models/dailyAttendance");
jest.mock("./payments-service");
jest.mock("../utils/transaction");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("BookingsService PT Drop-In", () => {
  const uid = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();
  const coachId = new Types.ObjectId().toString();
  const io = { emit: jest.fn() } as unknown as Server;
  const mockSession = {} as any;

  const memberDoc = {
    _id: new Types.ObjectId(),
    uid: { name: "Amina Helmy", _id: new Types.ObjectId(uid) },
  };

  const coachDoc = {
    _id: new Types.ObjectId(coachId),
    coachName: "Salma Ghazzawi",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn(mockSession),
    );
    (Member.findOne as jest.Mock).mockReturnValue({
      populate: jest.fn().mockResolvedValue(memberDoc),
    });
    (Coach.findById as jest.Mock).mockResolvedValue(coachDoc);
    (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(),
    });
    (DailyAttendance.recordPtAttendance as jest.Mock).mockResolvedValue(undefined);
    (DailyAttendance.recordPtGuestAttendance as jest.Mock).mockResolvedValue(undefined);
  });

  describe("resolvePtDropInPrice", () => {
    it("returns default 750 when no location or class found", async () => {
      (Class.findOne as jest.Mock).mockResolvedValue(null);
      const price = await BookingsService.resolvePtDropInPrice();
      expect(price).toBe(DEFAULT_PT_DROP_IN_PRICE);
      expect(price).toBe(750);
    });

    it("returns configured price when PT class exists for branch", async () => {
      (Class.findOne as jest.Mock).mockResolvedValue({ price: 850 });
      const price = await BookingsService.resolvePtDropInPrice(locationId);
      expect(price).toBe(850);
    });

    it("prefers coach-specific price override when coach has ptDropInPrice set", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        coachName: "Captain Ahmed",
        ptDropInPrice: 1000,
      });
      (Class.findOne as jest.Mock).mockResolvedValue({ price: 850 });

      const price = await BookingsService.resolvePtDropInPrice(locationId, coachId);
      expect(price).toBe(1000);
    });

    it("falls back to branch price if coach has no custom ptDropInPrice", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        coachName: "Captain Ahmed",
        ptDropInPrice: null,
      });
      (Class.findOne as jest.Mock).mockResolvedValue({ price: 850 });

      const price = await BookingsService.resolvePtDropInPrice(locationId, coachId);
      expect(price).toBe(850);
    });
  });

  describe("setPtCoachDropInPrice and listPtCoachDropInPrices", () => {
    it("updates coach PT drop-in price override", async () => {
      const mockCoach = {
        _id: new Types.ObjectId(),
        coachName: "Captain Ahmed",
        ptDropInPrice: null,
        save: jest.fn().mockResolvedValue(true),
      };
      (Coach.findById as jest.Mock).mockResolvedValue(mockCoach);

      const res = await BookingsService.setPtCoachDropInPrice(coachId, 950);
      expect(mockCoach.ptDropInPrice).toBe(950);
      expect(mockCoach.save).toHaveBeenCalled();
      expect(res.price).toBe(950);
    });

    it("clears coach PT drop-in price override when null is passed", async () => {
      const mockCoach = {
        _id: new Types.ObjectId(),
        coachName: "Captain Ahmed",
        ptDropInPrice: 950,
        save: jest.fn().mockResolvedValue(true),
      };
      (Coach.findById as jest.Mock).mockResolvedValue(mockCoach);

      const res = await BookingsService.setPtCoachDropInPrice(coachId, null);
      expect(mockCoach.ptDropInPrice).toBeNull();
      expect(mockCoach.save).toHaveBeenCalled();
      expect(res.price).toBeNull();
    });

    it("lists coach PT drop-in prices", async () => {
      const mockId = new Types.ObjectId();
      (Coach.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockResolvedValue([
          {
            _id: mockId,
            coachName: "Captain Ahmed",
            ptDropInPrice: 950,
          },
        ]),
      });

      const list = await BookingsService.listPtCoachDropInPrices();
      expect(list).toEqual([
        {
          coachId: mockId.toString(),
          coachName: "Captain Ahmed",
          price: 950,
        },
      ]);
    });
  });

  describe("setPtDropInPrice", () => {
    it("updates existing PT class price", async () => {
      const mockClass = { price: 750, save: jest.fn().mockResolvedValue(true) };
      (Location.findById as jest.Mock).mockResolvedValue({ branchName: "New Cairo" });
      (Class.findOne as jest.Mock).mockResolvedValue(mockClass);

      const res = await BookingsService.setPtDropInPrice(locationId, 900);
      expect(mockClass.price).toBe(900);
      expect(mockClass.save).toHaveBeenCalled();
      expect(res).toEqual({
        locationId,
        branchName: "New Cairo",
        price: 900,
      });
    });

    it("creates new PT class template if not exists", async () => {
      (Location.findById as jest.Mock).mockResolvedValue({ branchName: "Zamalek" });
      (Class.findOne as jest.Mock).mockResolvedValue(null);
      (Class.create as jest.Mock).mockResolvedValue({ price: 750 });

      const res = await BookingsService.setPtDropInPrice(locationId, 750);
      expect(Class.create).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "PERSONAL_TRAINING",
          price: 750,
        }),
      );
      expect(res.price).toBe(750);
    });
  });

  describe("recordAdminPtMemberDropIn", () => {
    it("records member PT drop-in with coach", async () => {
      (Class.findOne as jest.Mock).mockResolvedValue({ price: 750 });

      await BookingsService.recordAdminPtMemberDropIn(
        uid,
        "CASH",
        io,
        locationId,
        coachId,
      );

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
        undefined,
        "PT dropin with Salma Ghazzawi",
        undefined,
        undefined,
        locationId,
      );

      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "PT dropin with Salma Ghazzawi",
        mockSession,
        "SUCCESS",
        io,
        locationId,
        coachId,
        undefined,
      );

      expect(io.emit).toHaveBeenCalledWith("SUCCESS-SCAN", {
        code: "PT_DROP_IN",
        message: "Success",
        member: "Amina Helmy",
        method: "PT dropin with Salma Ghazzawi",
        coach: "Salma Ghazzawi",
        locationId,
      });
    });

    it("throws BadRequestError if coachId is missing", async () => {
      await expect(
        BookingsService.recordAdminPtMemberDropIn(
          uid,
          "CASH",
          io,
          locationId,
          undefined as any,
        ),
      ).rejects.toThrow("Trainer is required for Personal Training drop-in");
    });

    it("records member PT drop-in with custom amount and note", async () => {
      await BookingsService.recordAdminPtMemberDropIn(
        uid,
        "VISA",
        io,
        locationId,
        coachId,
        600,
        "2026-09-17T10:00:00.000Z",
        "Special discount",
      );

      expect(PaymentsService.savePayment).toHaveBeenCalledWith(
        uid,
        600,
        "VISA",
        "DROPIN",
        mockSession,
        undefined,
        undefined,
        undefined,
        undefined,
        "2026-09-17T10:00:00.000Z",
        "PT dropin with Salma Ghazzawi; Special discount",
        undefined,
        undefined,
        locationId,
      );

      expect(DailyAttendance.recordPtAttendance).toHaveBeenCalledWith(
        uid,
        "PT dropin with Salma Ghazzawi",
        mockSession,
        "SUCCESS",
        io,
        locationId,
        coachId,
        expect.any(Date),
      );
    });
  });

  describe("recordAdminPtGuestDropIn", () => {
    it("throws ConflictError if guest phone matches an existing member", async () => {
      (User.findOne as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      await expect(
        BookingsService.recordAdminPtGuestDropIn(
          "Guest User",
          "01012345678",
          "CASH",
          io,
          locationId,
          coachId,
        ),
      ).rejects.toThrow(ConflictError);
    });

    it("throws BadRequestError if coachId is missing when recording guest PT drop-in", async () => {
      (User.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        BookingsService.recordAdminPtGuestDropIn(
          "Guest User",
          "01012345678",
          "CASH",
          io,
          locationId,
          undefined as any,
        ),
      ).rejects.toThrow("Trainer is required for Personal Training drop-in");
    });

    it("records guest PT drop-in with coach successfully", async () => {
      (User.findOne as jest.Mock).mockResolvedValue(null);
      (Class.findOne as jest.Mock).mockResolvedValue(null);

      await BookingsService.recordAdminPtGuestDropIn(
        "Walk-in Trainee",
        "01200000000",
        "INSTAPAY",
        io,
        locationId,
        coachId,
      );

      expect(PaymentsService.savePayment).toHaveBeenCalledWith(
        undefined,
        750,
        "INSTAPAY",
        "DROPIN",
        mockSession,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "PT dropin with Salma Ghazzawi",
        "Walk-in Trainee",
        "01200000000",
        locationId,
      );

      expect(DailyAttendance.recordPtGuestAttendance).toHaveBeenCalledWith(
        "Walk-in Trainee",
        "01200000000",
        "PT dropin with Salma Ghazzawi",
        mockSession,
        "SUCCESS",
        io,
        locationId,
        coachId,
        undefined,
      );

      expect(io.emit).toHaveBeenCalledWith("SUCCESS-SCAN", {
        code: "PT_DROP_IN",
        message: "Success",
        member: "Walk-in Trainee",
        method: "PT dropin with Salma Ghazzawi",
        coach: "Salma Ghazzawi",
        locationId,
      });
    });
  });
});
