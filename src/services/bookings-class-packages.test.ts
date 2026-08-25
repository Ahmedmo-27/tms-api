import { Types } from "mongoose";
import { BookingsService } from "./bookings-service";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import Package from "../models/package";
import Reservation from "../models/reservation";
import WaitlistEntry from "../models/waitlistEntry";
import { NotFoundError } from "../core/ApiError";
import { BOOKING_ERROR_MESSAGES } from "../utils/booking-package-errors";
import * as matchaBranch from "../utils/matcha-branch";

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

describe("BookingsService.addBooking class package catalog", () => {
  const uid = new Types.ObjectId().toString();
  const scid = new Types.ObjectId().toString();
  const classTitle = "Mat Pilates 9 am";

  const scheduledClass = {
    _id: new Types.ObjectId(scid),
    availableSlots: 10,
    bookedMembers: [],
    startTime: new Date(Date.now() + 86400000),
    cid: {
      _id: new Types.ObjectId(),
      title: classTitle,
      category: "STUDIO",
      price: 450,
      points: 1,
      locations: [{ branchName: "New Cairo" }],
    },
    locationId: { branchName: "New Cairo" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(false);
    (matchaBranch.ensureMemberForPendingPurchase as jest.Mock).mockResolvedValue(
      {},
    );
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(scheduledClass),
      }),
    });
    (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
    (Reservation.countDocuments as jest.Mock).mockResolvedValue(0);
    (Reservation.findOne as jest.Mock).mockResolvedValue(null);
    (WaitlistEntry.findOne as jest.Mock).mockResolvedValue(null);
  });

  it("throws NO_CLASS_PACKAGES_CONFIGURED when no catalog packages open the class", async () => {
    (Package.getClassPackages as jest.Mock).mockResolvedValue([]);

    await expect(BookingsService.addBooking(uid, scid, true)).rejects.toMatchObject(
      {
        code: "NO_CLASS_PACKAGES_CONFIGURED",
        message: BOOKING_ERROR_MESSAGES.NO_CLASS_PACKAGES_CONFIGURED(classTitle),
      },
    );
    expect(Package.getClassPackages).toHaveBeenCalled();
  });

  it("does not reuse NO_ACTIVE_PACKAGE_FOUND for an empty catalog", async () => {
    (Package.getClassPackages as jest.Mock).mockResolvedValue([]);

    await expect(BookingsService.addBooking(uid, scid, true)).rejects.toEqual(
      expect.objectContaining({
        code: "NO_CLASS_PACKAGES_CONFIGURED",
      }),
    );
    await expect(BookingsService.addBooking(uid, scid, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
