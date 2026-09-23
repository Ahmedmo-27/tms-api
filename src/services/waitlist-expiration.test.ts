import { Types, ClientSession } from "mongoose";
import { WaitlistService } from "./waitlist-service";
import Reservation from "../models/reservation";
import WaitlistEntry from "../models/waitlistEntry";
import logger from "../config/logger";

jest.mock("../models/reservation", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}));

jest.mock("../models/waitlistEntry", () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
  },
}));

const mockSession = {} as ClientSession;
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(async (fn) => fn(mockSession)),
}));

jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("WaitlistService.expireReservations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("finds expired active reservations, marks them EXPIRED, updates waitlist entry, and triggers processWaitlist", async () => {
    const sessionId = new Types.ObjectId();
    const userId1 = new Types.ObjectId();
    const userId2 = new Types.ObjectId();

    const mockRes1 = {
      sessionId,
      userId: userId1,
      status: "ACTIVE",
      save: jest.fn().mockResolvedValue(undefined),
    };

    const mockRes2 = {
      sessionId,
      userId: userId2,
      status: "ACTIVE",
      save: jest.fn().mockResolvedValue(undefined),
    };

    (Reservation.find as jest.Mock).mockResolvedValue([mockRes1, mockRes2]);
    (WaitlistEntry.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

    const processWaitlistSpy = jest
      .spyOn(WaitlistService, "processWaitlist")
      .mockResolvedValue(undefined);

    await WaitlistService.expireReservations();

    expect(Reservation.find).toHaveBeenCalledWith({
      status: "ACTIVE",
      expiresAt: { $lte: expect.any(Date) },
    });

    expect(mockRes1.status).toBe("EXPIRED");
    expect(mockRes1.save).toHaveBeenCalledWith({ session: mockSession });
    expect(WaitlistEntry.updateOne).toHaveBeenCalledWith(
      {
        sessionId,
        userId: userId1,
        status: "NOTIFIED",
      },
      { status: "EXPIRED" },
      { session: mockSession }
    );

    expect(mockRes2.status).toBe("EXPIRED");
    expect(mockRes2.save).toHaveBeenCalledWith({ session: mockSession });
    expect(WaitlistEntry.updateOne).toHaveBeenCalledWith(
      {
        sessionId,
        userId: userId2,
        status: "NOTIFIED",
      },
      { status: "EXPIRED" },
      { session: mockSession }
    );

    expect(processWaitlistSpy).toHaveBeenCalledTimes(2);
    expect(processWaitlistSpy).toHaveBeenCalledWith(sessionId.toString());
  });

  it("does nothing when there are no expired reservations", async () => {
    (Reservation.find as jest.Mock).mockResolvedValue([]);
    const processWaitlistSpy = jest
      .spyOn(WaitlistService, "processWaitlist")
      .mockResolvedValue(undefined);

    await WaitlistService.expireReservations();

    expect(Reservation.find).toHaveBeenCalledWith({
      status: "ACTIVE",
      expiresAt: { $lte: expect.any(Date) },
    });
    expect(WaitlistEntry.updateOne).not.toHaveBeenCalled();
    expect(processWaitlistSpy).not.toHaveBeenCalled();
  });

  it("logs an error if an exception occurs during expiration processing", async () => {
    (Reservation.find as jest.Mock).mockRejectedValue(new Error("DB failure"));

    await WaitlistService.expireReservations();

    expect(logger.error).toHaveBeenCalledWith(
      "Error running expireReservations cron job:",
      expect.any(Error)
    );
  });
});
