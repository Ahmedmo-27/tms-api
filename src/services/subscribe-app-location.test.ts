import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import User from "../models/user";
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

describe("APP subscribeToPackage locationId fix", () => {
  const uid = new Types.ObjectId().toString();
  const cairoId = new Types.ObjectId().toString();
  const matchaId = new Types.ObjectId().toString();
  const cairoOpenGymId = new Types.ObjectId();
  const matchaOpenGymId = new Types.ObjectId();
  const studioPkgId = new Types.ObjectId();
  const merchantRef = "merchant-ref-001";

  const basePkgFields = {
    numberOfSessions: 10,
    price: 2500,
    expiryPeriod: 30,
    classRestrictions: undefined,
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
    (matchaBranch.assertMatchaPackageForPendingUser as jest.Mock).mockResolvedValue(
      undefined,
    );
    (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
    (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);
    (Member.addPackage as jest.Mock).mockResolvedValue(undefined);
    (User.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue({ _id: uid, phoneNumber: null }),
    });
    (PaymentsService.checkPayment as jest.Mock).mockResolvedValue("order-1");
    (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
      _id: new Types.ObjectId(),
      amount: 2500,
    });
    (sendPaymentToRentalSystem as jest.Mock).mockResolvedValue(undefined);
  });

  function mockPkg(overrides: Record<string, unknown>) {
    (Package.findById as jest.Mock).mockResolvedValue({
      _id: overrides._id,
      name: overrides.name,
      category: overrides.category ?? "OPEN_GYM",
      locationId: overrides.locationId ?? null,
      ...basePkgFields,
      ...overrides,
    });
  }

  it("passes resolved locationId into savePayment and addPackage (studio → main/Cairo)", async () => {
    mockPkg({
      _id: studioPkgId,
      name: "10 Studio",
      category: "STUDIO",
      locationId: null,
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      cairoId,
    );

    await SubscriptionsService.subscribeToPackage(
      uid,
      studioPkgId.toString(),
      new Date().toISOString(),
      "APP",
      merchantRef,
    );

    expect(PaymentsService.checkPayment).toHaveBeenCalledWith(
      merchantRef,
      2500,
    );
    expect(PaymentsService.savePayment).toHaveBeenCalledWith(
      uid,
      2500,
      "APP",
      "PACKAGE",
      expect.anything(),
      "order-1",
      merchantRef,
      undefined,
      studioPkgId,
      undefined,
      undefined,
      undefined,
      undefined,
      cairoId,
    );
    expect(Member.addPackage).toHaveBeenCalledWith(
      uid,
      studioPkgId.toString(),
      "10 Studio",
      10,
      expect.any(String),
      expect.any(String),
      expect.anything(),
      undefined,
      cairoId,
    );
  });

  it("uses Cairo package.locationId when buying Cairo open gym from the app", async () => {
    mockPkg({
      _id: cairoOpenGymId,
      name: "Open Gym Cairo",
      category: "OPEN_GYM",
      locationId: new Types.ObjectId(cairoId),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      cairoId,
    );

    await SubscriptionsService.subscribeToPackage(
      uid,
      cairoOpenGymId.toString(),
      new Date().toISOString(),
      "APP",
      "ref-cairo",
    );

    expect(appPackageLocation.resolveAppPackageLocationId).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: expect.anything(),
      }),
      false,
    );
    const saveArgs = (PaymentsService.savePayment as jest.Mock).mock.calls[0];
    expect(saveArgs[saveArgs.length - 1]).toBe(cairoId);
    const addArgs = (Member.addPackage as jest.Mock).mock.calls[0];
    expect(addArgs[addArgs.length - 1]).toBe(cairoId);
  });

  it("uses Matcha package.locationId when buying Matcha open gym from the app", async () => {
    mockPkg({
      _id: matchaOpenGymId,
      name: "Open Gym Matcha",
      category: "OPEN_GYM",
      locationId: new Types.ObjectId(matchaId),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      matchaId,
    );

    await SubscriptionsService.subscribeToPackage(
      uid,
      matchaOpenGymId.toString(),
      new Date().toISOString(),
      "APP",
      "ref-matcha",
    );

    const saveArgs = (PaymentsService.savePayment as jest.Mock).mock.calls[0];
    expect(saveArgs[saveArgs.length - 1]).toBe(matchaId);
    const addArgs = (Member.addPackage as jest.Mock).mock.calls[0];
    expect(addArgs[addArgs.length - 1]).toBe(matchaId);
  });

  it("buying packages from two branches records distinct locationIds on each payment", async () => {
    // Purchase 1 — Cairo
    mockPkg({
      _id: cairoOpenGymId,
      name: "Open Gym Cairo",
      locationId: new Types.ObjectId(cairoId),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValueOnce(
      cairoId,
    );
    await SubscriptionsService.subscribeToPackage(
      uid,
      cairoOpenGymId.toString(),
      new Date().toISOString(),
      "APP",
      "ref-1",
    );

    // Purchase 2 — Matcha
    mockPkg({
      _id: matchaOpenGymId,
      name: "Open Gym Matcha",
      locationId: new Types.ObjectId(matchaId),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValueOnce(
      matchaId,
    );
    await SubscriptionsService.subscribeToPackage(
      uid,
      matchaOpenGymId.toString(),
      new Date().toISOString(),
      "APP",
      "ref-2",
    );

    expect(PaymentsService.savePayment).toHaveBeenCalledTimes(2);
    const loc1 =
      (PaymentsService.savePayment as jest.Mock).mock.calls[0].at(-1);
    const loc2 =
      (PaymentsService.savePayment as jest.Mock).mock.calls[1].at(-1);
    expect(loc1).toBe(cairoId);
    expect(loc2).toBe(matchaId);
    expect(loc1).not.toBe(loc2);

    expect(Member.addPackage).toHaveBeenCalledTimes(2);
    expect((Member.addPackage as jest.Mock).mock.calls[0].at(-1)).toBe(cairoId);
    expect((Member.addPackage as jest.Mock).mock.calls[1].at(-1)).toBe(
      matchaId,
    );
  });

  it("pending members always get Matcha locationId on payment", async () => {
    (matchaBranch.isPendingMember as jest.Mock).mockResolvedValue(true);
    mockPkg({
      _id: matchaOpenGymId,
      name: "Open Gym Matcha",
      locationId: new Types.ObjectId(matchaId),
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      matchaId,
    );

    await SubscriptionsService.subscribeToPackage(
      uid,
      matchaOpenGymId.toString(),
      new Date().toISOString(),
      "APP",
      "ref-pending",
    );

    expect(appPackageLocation.resolveAppPackageLocationId).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
    expect(
      (PaymentsService.savePayment as jest.Mock).mock.calls[0].at(-1),
    ).toBe(matchaId);
  });

  it("never calls savePayment without a locationId (regression for Geidea confirm 400)", async () => {
    mockPkg({
      _id: studioPkgId,
      name: "10 Studio",
      category: "STUDIO",
      locationId: null,
    });
    (appPackageLocation.resolveAppPackageLocationId as jest.Mock).mockResolvedValue(
      cairoId,
    );

    await SubscriptionsService.subscribeToPackage(
      uid,
      studioPkgId.toString(),
      new Date().toISOString(),
      "APP",
      merchantRef,
    );

    for (const call of (PaymentsService.savePayment as jest.Mock).mock.calls) {
      const locationId = call.at(-1);
      expect(locationId).toBeTruthy();
      expect(Types.ObjectId.isValid(locationId)).toBe(true);
    }
  });
});
