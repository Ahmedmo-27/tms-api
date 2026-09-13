import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import { cleanUpDeprecatedPackages } from "./package-deletion-guard";
import { BadRequestError } from "../core/ApiError";

import Payment from "../models/payment";

jest.mock("../models/member");
jest.mock("../models/payment");
jest.mock("../models/package", () => {
  const actual = jest.requireActual("../models/package");
  return {
    __esModule: true,
    ...actual,
    default: {
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndDelete: jest.fn(),
      countDocuments: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
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
  runInTransaction: jest.fn(async (fn) => fn(undefined)),
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("Package Deprecation and Soft-Deletion", () => {
  const pkgId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("cleanUpDeprecatedPackages", () => {
    it("deletes deprecated package if it has 0 subscribers and 0 payments", async () => {
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "Test Package", isDeprecated: true },
      ]);
      (Member.countDocuments as jest.Mock).mockResolvedValue(0);
      (Payment.countDocuments as jest.Mock).mockResolvedValue(0);

      await cleanUpDeprecatedPackages();

      expect(Member.countDocuments).toHaveBeenCalledWith({
        "packages.pkgId": pkgId,
      });
      expect(Payment.countDocuments).toHaveBeenCalledWith({
        pkgId: pkgId,
      });
      expect(Package.findByIdAndDelete).toHaveBeenCalledWith(pkgId);
    });

    it("does not delete deprecated package if it has subscription history", async () => {
      (Package.find as jest.Mock).mockResolvedValue([
        { _id: pkgId, name: "Test Package", isDeprecated: true },
      ]);
      (Member.countDocuments as jest.Mock).mockResolvedValue(2);
      (Payment.countDocuments as jest.Mock).mockResolvedValue(0);

      await cleanUpDeprecatedPackages();

      expect(Package.findByIdAndDelete).not.toHaveBeenCalled();
    });
  });

  describe("SubscriptionsService", () => {
    it("frontDeskSubscribeToPackage throws PACKAGE_DEPRECATED if package is deprecated", async () => {
      (Member.findOne as jest.Mock).mockResolvedValue({ uid: "user1" });
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: pkgId,
        isDeprecated: true,
      });

      await expect(
        SubscriptionsService.frontDeskSubscribeToPackage(
          "user1",
          pkgId.toString(),
          "2026-07-03",
          "CASH",
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("subscribeToPackage throws PACKAGE_DEPRECATED if package is deprecated", async () => {
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: pkgId,
        isDeprecated: true,
      });

      await expect(
        SubscriptionsService.subscribeToPackage(
          "user1",
          pkgId.toString(),
          "2026-07-03",
          "APP",
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("addNonUserPackage throws PACKAGE_DEPRECATED if package is deprecated", async () => {
      (Package.findById as jest.Mock).mockResolvedValue({
        _id: pkgId,
        isDeprecated: true,
      });

      await expect(
        SubscriptionsService.addNonUserPackage(
          "John Doe",
          "01001952003",
          pkgId.toString(),
          "2026-07-03",
          "CASH",
          false,
        ),
      ).rejects.toThrow(BadRequestError);
    });
  });
});
