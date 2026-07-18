import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import NonUserPackage from "../models/nonUserPackage";
import { ConflictError } from "../core/ApiError";

jest.mock("../models/member");
jest.mock("../models/nonUserPackage");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const CATEGORIES = [
  "FUNCTIONAL_TRAINING",
  "STUDIO",
  "PERSONAL_TRAINING",
  "PRE_POST_NATAL",
  "MIXED",
  "SPACE_MEMBERSHIP",
  "ULTIMATE_MINDSPACER",
  "OPEN_GYM",
] as const;

describe("Duplicate prevention across package categories", () => {
  const startDate = "2026-07-03T21:00:00.000Z";
  const phoneNumber = "01001952003";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(CATEGORIES)(
    "rejects duplicate unused NonUserPackage for %s",
    async (category) => {
      const pkgId = new Types.ObjectId();
      (NonUserPackage.findOne as jest.Mock).mockResolvedValue({
        _id: new Types.ObjectId(),
        category,
      });

      await expect(
        SubscriptionsService.assertNoDuplicateNonUserPackage(
          phoneNumber,
          pkgId.toString(),
          startDate,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it.each(CATEGORIES)(
    "rejects duplicate member package for %s",
    async () => {
      (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(true);

      await expect(
        SubscriptionsService.assertNoDuplicateMemberPackage(
          new Types.ObjectId().toString(),
          new Types.ObjectId().toString(),
          startDate,
        ),
      ).rejects.toMatchObject({ code: "PACKAGE_ALREADY_ADDED" });
    },
  );

  it("allows NonUserPackage when no unused staged row exists", async () => {
    (NonUserPackage.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      SubscriptionsService.assertNoDuplicateNonUserPackage(
        phoneNumber,
        new Types.ObjectId().toString(),
        startDate,
      ),
    ).resolves.toBeUndefined();
  });
});
