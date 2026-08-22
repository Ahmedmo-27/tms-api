import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import User from "../models/user";
import Payment from "../models/payment";
import { PaymentsService } from "./payments-service";
import { runInTransaction } from "../utils/transaction";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";
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
    },
  };
});
jest.mock("../models/user");
jest.mock("../models/payment");
jest.mock("../models/promoCode", () => ({
  __esModule: true,
  default: { getDiscountedPrice: jest.fn() },
}));
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

describe("SubscriptionsService.subscribeToPackage idempotency", () => {
  const uid = new Types.ObjectId().toString();
  const pkgId = new Types.ObjectId();
  const mref = `${pkgId.toString()}35bb`;
  const cairoId = new Types.ObjectId().toString();
  const paymentId = new Types.ObjectId();
  const startDate = "2026-07-28T00:00:00.000+03:00";

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn({}),
    );
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(false);
    (matchaBranch.ensureMemberForPendingPurchase as jest.Mock).mockResolvedValue(
      {},
    );
    (matchaBranch.assertMatchaPackageForPendingUser as jest.Mock).mockResolvedValue(
      undefined,
    );
    (Package.findById as jest.Mock).mockResolvedValue({
      _id: pkgId,
      name: "10 Studio",
      category: "STUDIO",
      numberOfSessions: 10,
      price: 3825,
      expiryPeriod: 100,
      classRestrictions: undefined,
      locationId: null,
    });
    (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
    (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);
    (Member.addPackage as jest.Mock).mockResolvedValue(undefined);
    (User.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue({ _id: uid, phoneNumber: null }),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      cairoId,
    );
    (Payment.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    });
    (sendPaymentToRentalSystem as jest.Mock).mockResolvedValue(undefined);
  });

  it("no-ops when payment and package already exist for merchant ref", async () => {
    (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue({
      _id: paymentId,
    });
    (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(true);

    await SubscriptionsService.subscribeToPackage(
      uid,
      pkgId.toString(),
      startDate,
      "APP",
      mref,
    );

    expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
    expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    expect(Member.addPackage).not.toHaveBeenCalled();
  });

  it("adds package only when payment exists but package missing", async () => {
    (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue({
      _id: paymentId,
    });
    (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);

    await SubscriptionsService.subscribeToPackage(
      uid,
      pkgId.toString(),
      startDate,
      "APP",
      mref,
    );

    expect(PaymentsService.checkPayment).not.toHaveBeenCalled();
    expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    expect(Member.addPackage).toHaveBeenCalled();
    expect(sendPaymentToRentalSystem).not.toHaveBeenCalled();
  });

  it("creates payment + package on first confirm", async () => {
    (PaymentsService.findPaymentByMerchantReference as jest.Mock).mockResolvedValue(
      null,
    );
    (PaymentsService.checkPayment as jest.Mock).mockResolvedValue("order-1");
    (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
      _id: paymentId,
      amount: 3825,
    });

    await SubscriptionsService.subscribeToPackage(
      uid,
      pkgId.toString(),
      startDate,
      "APP",
      mref,
    );

    expect(PaymentsService.checkPayment).toHaveBeenCalledWith(mref, 3825);
    expect(PaymentsService.savePayment).toHaveBeenCalled();
    expect(Member.addPackage).toHaveBeenCalled();
  });
});
