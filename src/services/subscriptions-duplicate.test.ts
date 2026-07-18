import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";
import User from "../models/user";
import { PaymentsService } from "./payments-service";
import { ConflictError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";
import { sendPaymentToRentalSystem } from "./egygap-erp-service";

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
jest.mock("../models/nonUserPackage");
jest.mock("../models/user");
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

describe("SubscriptionsService duplicate package prevention", () => {
  const pkgId = new Types.ObjectId();
  const startDate = "2026-07-03T21:00:00.000Z";
  const phoneNumber = "01001952003";

  beforeEach(() => {
    jest.clearAllMocks();
    (runInTransaction as jest.Mock).mockImplementation(async (fn: any) =>
      fn(undefined),
    );
  });

  describe("assertNoDuplicateNonUserPackage", () => {
    it("throws PACKAGE_ALREADY_ADDED when an unused staged package exists", async () => {
      (NonUserPackage.findOne as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
      });

      await expect(
        SubscriptionsService.assertNoDuplicateNonUserPackage(
          phoneNumber,
          pkgId.toString(),
          startDate,
        ),
      ).rejects.toMatchObject({
        code: "PACKAGE_ALREADY_ADDED",
      });
    });

    it("allows add when no unused staged package exists", async () => {
      (NonUserPackage.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        SubscriptionsService.assertNoDuplicateNonUserPackage(
          phoneNumber,
          pkgId.toString(),
          startDate,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("assertNoDuplicateMemberPackage", () => {
    it("throws when member already has package on that start day", async () => {
      (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(true);

      await expect(
        SubscriptionsService.assertNoDuplicateMemberPackage(
          new Types.ObjectId().toString(),
          pkgId.toString(),
          startDate,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("addNonUserPackage", () => {
    beforeEach(() => {
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: pkgId,
        price: 2750,
        numberOfSessions: 10000,
        category: "OPEN_GYM",
        expiryPeriod: 30,
      });
    });

    it("rejects duplicate staged package before creating payment", async () => {
      jest
        .spyOn(SubscriptionsService, "assertNoDuplicateNonUserPackage")
        .mockRejectedValueOnce(
          new ConflictError("PACKAGE_ALREADY_ADDED", "Package already added"),
        );

      await expect(
        SubscriptionsService.addNonUserPackage(
          "Sara Elaraby",
          phoneNumber,
          pkgId.toString(),
          startDate,
          "VISA",
          false,
        ),
      ).rejects.toMatchObject({ code: "PACKAGE_ALREADY_ADDED" });

      expect(PaymentsService.savePayment).not.toHaveBeenCalled();
      expect(sendPaymentToRentalSystem).not.toHaveBeenCalled();
    });

    it("rejects when a member with that phone already has the package", async () => {
      const uid = new Types.ObjectId();
      jest
        .spyOn(SubscriptionsService, "assertNoDuplicateNonUserPackage")
        .mockResolvedValueOnce(undefined);
      (User.findOne as jest.Mock).mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: uid, phoneNumber }),
      });
      jest
        .spyOn(SubscriptionsService, "assertNoDuplicateMemberPackage")
        .mockRejectedValueOnce(
          new ConflictError("PACKAGE_ALREADY_ADDED", "Package already added"),
        );

      await expect(
        SubscriptionsService.addNonUserPackage(
          "Sara Elaraby",
          phoneNumber,
          pkgId.toString(),
          startDate,
          "VISA",
          false,
        ),
      ).rejects.toMatchObject({ code: "PACKAGE_ALREADY_ADDED" });

      expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    });
  });
});
