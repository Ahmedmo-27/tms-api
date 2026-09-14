import { Types } from "mongoose";
import { BookingsService } from "./bookings-service";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import Package from "../models/package";
import { WaitlistService } from "./waitlist-service";
import { runInTransaction } from "../utils/transaction";

jest.mock("../models/member");
jest.mock("../models/scheduledClass");
jest.mock("../models/package");
jest.mock("../models/reservation");
jest.mock("../models/waitlistEntry");
jest.mock("../models/promoCode");
jest.mock("../models/payment");
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(),
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock("../utils/matcha-branch");
jest.mock("../utils/app-package-location");
jest.mock("./egygap-erp-service", () => ({
  sendPaymentToRentalSystem: jest.fn(),
}));
jest.mock("./payments-service");
jest.mock("./waitlist-service");

const HOUR = 60 * 60 * 1000;

describe("BookingsService.cancelBooking late-cancellation policy", () => {
  const uid = new Types.ObjectId().toString();
  const scid = new Types.ObjectId().toString();
  const cid = new Types.ObjectId();
  const catalogPkgId = new Types.ObjectId();
  const className = "Mat Pilates";

  let startTime: Date;

  const setup = (opts: {
    hoursUntilStart: number;
    isDropIn?: boolean;
    price?: number;
  }) => {
    startTime = new Date(Date.now() + opts.hoursUntilStart * HOUR);
    const pkgStartDate = new Date("2026-09-01T00:00:00.000Z");
    const member = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: new Types.ObjectId(scid), isDropIn: !!opts.isDropIn },
      ],
      packages: [
        {
          pkgId: catalogPkgId,
          pkgStartDate,
          status: "ACTIVE",
          remainingClasses: 4,
          adjustmentHistory: [
            {
              date: new Date(Date.now() - 24 * HOUR),
              source: "BOOKING",
              type: "DEDUCT",
              amount: 1,
              className,
              attendanceDate: startTime,
            },
          ],
        },
      ],
    };
    (Member.findOne as jest.Mock).mockResolvedValue(member);
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      populate: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(scid),
        startTime,
        cid: { _id: cid, title: className, category: "STUDIO", price: opts.price ?? 450 },
      }),
    });
    (Package.find as jest.Mock).mockResolvedValue([{ _id: catalogPkgId }]);
    return { member, pkgStartDate };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation((fn) => fn(undefined));
    (WaitlistService.processWaitlist as jest.Mock).mockResolvedValue(undefined);
  });

  it("member cancelling more than 3h before gets the session back", async () => {
    setup({ hoursUntilStart: 5 });

    const result = await BookingsService.cancelBooking(uid, scid, "member");

    expect(result).toEqual({ lateCancellation: false, sessionReturned: true });
    const removeArgs = (Member.removeBooking as jest.Mock).mock.calls[0];
    expect(removeArgs[3]).toBe(true); // isDeducted → session returned
    expect(removeArgs[7]).toBe("MEMBER_CANCELLATION");
    expect(Member.pushAdjustmentRecord).not.toHaveBeenCalled();
    expect(ScheduledClass.removeBookedMember).toHaveBeenCalled();
    expect(WaitlistService.processWaitlist).toHaveBeenCalledWith(scid);
  });

  it("member cancelling within 3h: booking removed, session NOT returned, history note added", async () => {
    const { pkgStartDate } = setup({ hoursUntilStart: 2 });

    const result = await BookingsService.cancelBooking(uid, scid, "member");

    expect(result).toEqual({ lateCancellation: true, sessionReturned: false });
    expect((Member.removeBooking as jest.Mock).mock.calls[0][3]).toBe(false);
    expect(Member.pushAdjustmentRecord).toHaveBeenCalledWith(
      uid,
      catalogPkgId.toString(),
      pkgStartDate,
      expect.objectContaining({
        source: "MEMBER_CANCELLATION",
        type: "DEDUCT",
        amount: 0,
        className,
      }),
      undefined,
    );
    expect(ScheduledClass.removeBookedMember).toHaveBeenCalled();
    expect(WaitlistService.processWaitlist).toHaveBeenCalledWith(scid);
  });

  it("staff cancelling within 3h always returns the session", async () => {
    setup({ hoursUntilStart: 1 });

    const result = await BookingsService.cancelBooking(uid, scid, "staff");

    expect(result).toEqual({ lateCancellation: false, sessionReturned: true });
    const removeArgs = (Member.removeBooking as jest.Mock).mock.calls[0];
    expect(removeArgs[3]).toBe(true);
    expect(removeArgs[7]).toBe("FRONTDESK_CANCELLATION");
    expect(Member.pushAdjustmentRecord).not.toHaveBeenCalled();
  });

  it("rejects cancelling after the class started", async () => {
    setup({ hoursUntilStart: -0.1 });

    await expect(
      BookingsService.cancelBooking(uid, scid, "member"),
    ).rejects.toMatchObject({ code: "CLASS_ALREADY_STARTED" });
    expect(Member.removeBooking).not.toHaveBeenCalled();
  });

  it("drop-ins are still blocked within 3h", async () => {
    setup({ hoursUntilStart: 2, isDropIn: true });

    await expect(
      BookingsService.cancelBooking(uid, scid, "member"),
    ).rejects.toMatchObject({ code: "DEADLINE_PASSED" });
    expect(Member.removeBooking).not.toHaveBeenCalled();
  });

  it("free class within 3h is cancelled without touching the package", async () => {
    setup({ hoursUntilStart: 2, price: 0 });

    const result = await BookingsService.cancelBooking(uid, scid, "member");

    expect(result).toEqual({ lateCancellation: false, sessionReturned: false });
    expect((Member.removeBooking as jest.Mock).mock.calls[0][3]).toBe(false);
    expect(Member.pushAdjustmentRecord).not.toHaveBeenCalled();
  });
});
