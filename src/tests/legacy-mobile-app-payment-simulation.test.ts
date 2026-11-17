/**
 * legacy-mobile-app-payment-simulation.test.ts
 *
 * Simulates how the system behaves when members are still using the LEGACY (un-updated)
 * mobile application that does not have unique merchant reference IDs or Geidea status checks.
 *
 * Verifies that the backend alone prevents:
 * 1. Historical payments (> 30 minutes old) from being recycled into free packages.
 * 2. Unpaid / cancelled checkouts on legacy app from granting packages or bookings.
 * 3. While preserving legitimate network retries within the safe 30-minute window.
 */

import { Types } from "mongoose";
import { BadRequestError, ConflictError } from "../core/ApiError";
import { SubscriptionsService } from "../services/subscriptions-service";
import { BookingsService } from "../services/bookings-service";
import { PaymentsService } from "../services/payments-service";
import Member from "../models/member";
import Package from "../models/package";
import User from "../models/user";
import Payment from "../models/payment";
import ScheduledClass from "../models/scheduledClass";
import { runInTransaction } from "../utils/transaction";
import * as matchaBranch from "../utils/matcha-branch";
import * as appPackageLocation from "../utils/app-package-location";

jest.mock("../models/member");
jest.mock("../models/package", () => {
  const actual = jest.requireActual("../models/package");
  return {
    __esModule: true,
    ...actual,
    default: {
      findById: jest.fn(),
      findOne: jest.fn(),
    },
  };
});
jest.mock("../models/user");
jest.mock("../models/payment");
jest.mock("../models/scheduledClass");
jest.mock("../models/promoCode", () => ({
  __esModule: true,
  default: { getDiscountedPrice: jest.fn() },
}));
jest.mock("../services/payments-service");
jest.mock("../services/egygap-erp-service", () => ({
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

describe("Simulation: Legacy Mobile App (Before Update is Installed)", () => {
  const uid = "69fb054c13c8a32010b938ed"; // Member Randa Hafez
  const pkgId = new Types.ObjectId("69e53352408d558187798185"); // "10 Studio"
  // Legacy mobile app static formula: ${packageId}${userId.substring(userId.length - 4)}
  const legacyMerchantRef = `${pkgId.toString()}38ed`;
  const cairoLocationId = new Types.ObjectId("69ec4abad8394559ce7ca77c").toString();
  const historicalPaymentId = new Types.ObjectId("6ad39b6981337b6ffb076be9");

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({}),
    );
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(false);
    (matchaBranch.ensureMemberForPendingPurchase as jest.Mock).mockResolvedValue({});
    (matchaBranch.assertMatchaPackageForPendingUser as jest.Mock).mockResolvedValue(undefined);
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(cairoLocationId);

    (Package.findById as jest.Mock).mockResolvedValue({
      _id: pkgId,
      name: "10 Studio",
      category: "STUDIO",
      numberOfSessions: 10,
      price: 4300,
      expiryPeriod: 60,
      classRestrictions: undefined,
      locationId: null,
    });

    (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
    (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);
    (Member.addPackage as jest.Mock).mockResolvedValue(undefined);
    (User.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue({
        _id: uid,
        name: "Randa Hafez",
        phoneNumber: "01223260030",
      }),
    });
    (Payment.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    });
  });

  describe("Scenario 1: Member cancels Geidea payment on legacy app (The Reported Issue)", () => {
    it("BLOCKS free package creation even when DB has a 30-day-old payment with the same static reference ID", async () => {
      // 1. The member has a payment from 30 days ago in MongoDB.
      // Under the patched backend, findPaymentByMerchantReference with maxAgeMinutes=30 returns null.
      (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockImplementation(
        async (mref: string, purpose?: string, maxAgeMinutes?: number) => {
          // If queried with maxAgeMinutes = 30, the 30-day-old payment is filtered out!
          if (maxAgeMinutes && maxAgeMinutes === 30) {
            return null; // Expired!
          }
          return {
            _id: historicalPaymentId,
            paymentTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
          };
        },
      );

      // 2. Because findPaymentByMerchantReference returns null, backend falls through to checkPayment.
      // Since member cancelled on Geidea, Geidea reports payment failed / not completed.
      (PaymentsService.checkPayment as jest.Mock).mockRejectedValue(
        new BadRequestError("PAYMENT_FAILED", "Payment is not completed"),
      );

      // 3. Legacy mobile app invokes POST /member/packages with the static reference ID:
      const todayDate = new Date().toISOString();
      await expect(
        SubscriptionsService.subscribeToPackage(
          uid,
          pkgId.toString(),
          todayDate,
          "APP",
          legacyMerchantRef,
        ),
      ).rejects.toThrow("Payment is not completed");

      // 4. Verify findPaymentByMerchantReference was queried with maxAgeMinutes = 30
      expect(PaymentsService.findPaymentByMerchantReference).toHaveBeenCalledWith(
        legacyMerchantRef,
        "PACKAGE",
        30,
      );

      // 5. Verify checkPayment was called to verify with Geidea
      expect(PaymentsService.checkPayment).toHaveBeenCalledWith(legacyMerchantRef, 4300);

      // 6. Verify NO package was added to the member account
      expect(Member.addPackage).not.toHaveBeenCalled();
      expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 2: Legitimate payment retry on legacy app (Network drop within 30 min)", () => {
    it("ALLOWS idempotent fulfillment when payment was genuinely completed 5 minutes ago", async () => {
      const recentPaymentId = new Types.ObjectId();

      // Payment was saved 5 minutes ago (< 30 min window)
      (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockImplementation(
        async (mref: string, purpose?: string, maxAgeMinutes?: number) => {
          if (mref === legacyMerchantRef && maxAgeMinutes === 30) {
            return {
              _id: recentPaymentId,
              paymentTime: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
            };
          }
          return null;
        },
      );

      (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);

      const todayDate = new Date().toISOString();
      await SubscriptionsService.subscribeToPackage(
        uid,
        pkgId.toString(),
        todayDate,
        "APP",
        legacyMerchantRef,
      );

      // checkPayment should NOT be called because recent payment exists
      expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
      // Package IS fulfilled idempotently
      expect(Member.addPackage).toHaveBeenCalled();
    });
  });

  describe("Scenario 3: Legacy app duplicate confirm when package already exists", () => {
    it("NO-OPS when user already has the package starting today", async () => {
      const recentPaymentId = new Types.ObjectId();

      (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue({
        _id: recentPaymentId,
        paymentTime: new Date(Date.now() - 2 * 60 * 1000),
      });
      // User already has this package on start day
      (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(true);

      const todayDate = new Date().toISOString();
      await SubscriptionsService.subscribeToPackage(
        uid,
        pkgId.toString(),
        todayDate,
        "APP",
        legacyMerchantRef,
      );

      expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
      expect(Member.addPackage).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 4: Geidea reports PAYMENT_ALREADY_RECORDED but DB payment is stale", () => {
    it("REJECTS fulfillment if the recorded payment in DB is older than 30 minutes", async () => {
      // First check returns null (> 30 mins)
      (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue(null);

      // Geidea throws ConflictError PAYMENT_ALREADY_RECORDED
      (PaymentsService.checkPayment as jest.Mock).mockRejectedValue(
        new ConflictError("PAYMENT_ALREADY_RECORDED", "Payment already recorded for this merchant reference"),
      );

      const todayDate = new Date().toISOString();
      await expect(
        SubscriptionsService.subscribeToPackage(
          uid,
          pkgId.toString(),
          todayDate,
          "APP",
          legacyMerchantRef,
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(Member.addPackage).not.toHaveBeenCalled();
    });
  });
});
