import { Types } from "mongoose";
import { BookingsService } from "./bookings-service";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import PromoCode from "../models/promoCode";
import Payment from "../models/payment";
import Reservation from "../models/reservation";
import WaitlistEntry from "../models/waitlistEntry";
import { PaymentsService } from "./payments-service";
import { runInTransaction } from "../utils/transaction";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
import * as matchaBranch from "../utils/matcha-branch";
import * as appPackageLocation from "../utils/app-package-location";

jest.mock("../models/member");
jest.mock("../models/scheduledClass");
jest.mock("../models/promoCode");
jest.mock("../models/payment");
jest.mock("../models/reservation");
jest.mock("../models/waitlistEntry");
jest.mock("./payments-service");
jest.mock("./egygap-erp-service", () => ({
  sendPaymentToRentalSystem: jest.fn(),
}));
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

describe("BookingsService.bookDropIn idempotency", () => {
  const uid = new Types.ObjectId().toString();
  const scid = new Types.ObjectId().toString();
  const mref = `${scid}492d`;
  const locationId = new Types.ObjectId().toString();
  const paymentId = new Types.ObjectId();

  const scheduledClass = {
    _id: new Types.ObjectId(scid),
    availableSlots: 10,
    bookedMembers: [],
    cid: {
      category: "STUDIO",
      allowDropIn: true,
      price: 450,
      locations: [],
    },
    startTime: new Date(Date.now() + 86400000),
    endTime: new Date(Date.now() + 90000000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({}),
    );
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(false);
    (matchaBranch.ensureMemberForPendingPurchase as jest.Mock).mockResolvedValue(
      {},
    );
    (matchaBranch.assertMatchaSessionForPendingUser as jest.Mock).mockResolvedValue(
      undefined,
    );
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      populate: jest.fn().mockResolvedValue(scheduledClass),
    });
    (Reservation.countDocuments as jest.Mock).mockResolvedValue(0);
    (Reservation.findOne as jest.Mock).mockResolvedValue(null);
    (WaitlistEntry.findOne as jest.Mock).mockResolvedValue(null);
    (appPackageLocation.resolveSessionPaymentLocationId as jest.Mock).mockResolvedValue(
      locationId,
    );
    (Member.saveDropIn as jest.Mock).mockResolvedValue(undefined);
    (ScheduledClass.bookMember as jest.Mock).mockResolvedValue(undefined);
    (sendPaymentToRentalSystem as jest.Mock).mockResolvedValue(undefined);
    (Payment.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    });

    // Avoid assertMemberBookingWindow throwing — stub via past/future times already set
    // Member booking window uses startTime; keep far future.
  });

  it("no-ops when member already booked the class", async () => {
    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      bookings: [{ scid: new Types.ObjectId(scid) }],
    });

    await BookingsService.bookDropIn(uid, scid, mref);

    expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
    expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    expect(Member.saveDropIn).not.toHaveBeenCalled();
  });

  it("finishes booking from existing payment without calling Geidea/savePayment", async () => {
    (Member.findOne as jest.Mock)
      .mockResolvedValueOnce({
        uid,
        bookings: [],
      })
      .mockResolvedValueOnce({
        uid,
        bookings: [],
      });
    (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue({
      _id: paymentId,
      merchantReferenceId: mref,
      purpose: "DROPIN",
    });

    await BookingsService.bookDropIn(uid, scid, mref);

    expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
    expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    expect(Member.saveDropIn).toHaveBeenCalledWith(
      uid,
      scid,
      paymentId.toString(),
      expect.anything(),
    );
    expect(ScheduledClass.bookMember).toHaveBeenCalledWith(
      scid,
      uid,
      "Drop In",
      expect.anything(),
    );
    expect(sendPaymentToRentalSystem).not.toHaveBeenCalled();
  });

  it("creates payment and books on first successful confirm", async () => {
    (Member.findOne as jest.Mock).mockResolvedValue({
      uid,
      bookings: [],
    });
    (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue(
      null,
    );
    (PaymentsService.checkPayment as jest.Mock).mockResolvedValue("order-new");
    (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
      _id: paymentId,
    });

    await BookingsService.bookDropIn(uid, scid, mref);

    expect(PaymentsService.checkPayment).toHaveBeenCalledWith(mref, 450);
    expect(PaymentsService.savePayment).toHaveBeenCalled();
    expect(Member.saveDropIn).toHaveBeenCalled();
    expect(ScheduledClass.bookMember).toHaveBeenCalled();
    expect(sendPaymentToRentalSystem).toHaveBeenCalled();
  });
});
