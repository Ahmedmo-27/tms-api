import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";

jest.mock("../models/member");
jest.mock("../models/package");
jest.mock("../models/nonUserPackage");
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("SubscriptionsService.transferStagedPackagesToMember", () => {
  const uid = new Types.ObjectId().toString();
  const pkgId = new Types.ObjectId();
  const startDate = new Date("2026-07-18T00:00:00.000Z");
  const endDate = new Date("2026-08-18T00:00:00.000Z");
  const session = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue({ uid }),
    });
    (Package.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue({
        _id: pkgId,
        name: "Space membership",
        numberOfSessions: 10000,
        classRestrictions: null,
      }),
    });
    (Member.addPackageIfAbsent as jest.Mock).mockResolvedValue(true);
    (NonUserPackage.findByIdAndUpdate as jest.Mock).mockResolvedValue({});
  });

  function mockStagedQuery(docs: unknown[]) {
    const query: {
      session: jest.Mock;
      sort: jest.Mock;
      then: (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise<unknown>;
    } = {
      session: jest.fn(),
      sort: jest.fn(),
      then: (onFulfilled, onRejected) =>
        Promise.resolve(docs).then(onFulfilled, onRejected),
    };
    query.session.mockReturnValue(query);
    query.sort.mockReturnValue(query);
    (NonUserPackage.find as jest.Mock).mockReturnValue(query);
    return query;
  }

  it("transfers unique staged packages and marks all records added", async () => {
    const firstId = new Types.ObjectId();
    const duplicateId = new Types.ObjectId();
    mockStagedQuery([
      {
        _id: firstId,
        pkgId,
        pkgStartDate: startDate,
        pkgEndDate: endDate,
        remainingClasses: 10000,
      },
      {
        _id: duplicateId,
        pkgId,
        pkgStartDate: startDate,
        pkgEndDate: endDate,
        remainingClasses: 10000,
      },
    ]);

    await SubscriptionsService.transferStagedPackagesToMember(
      uid,
      "01001952003",
      session,
    );

    expect(Member.addPackageIfAbsent).toHaveBeenCalledTimes(1);
    expect(NonUserPackage.findByIdAndUpdate).toHaveBeenCalledTimes(2);
    expect(NonUserPackage.findByIdAndUpdate).toHaveBeenCalledWith(
      firstId,
      { added: true },
      { session },
    );
    expect(NonUserPackage.findByIdAndUpdate).toHaveBeenCalledWith(
      duplicateId,
      { added: true },
      { session },
    );
  });

  it("does not fail when the package is already on the member", async () => {
    const stagedId = new Types.ObjectId();
    mockStagedQuery([
      {
        _id: stagedId,
        pkgId,
        pkgStartDate: startDate,
        pkgEndDate: endDate,
        remainingClasses: 10000,
      },
    ]);
    (Member.addPackageIfAbsent as jest.Mock).mockResolvedValue(false);

    await expect(
      SubscriptionsService.transferStagedPackagesToMember(
        uid,
        "01001952003",
        session,
      ),
    ).resolves.toBeUndefined();

    expect(NonUserPackage.findByIdAndUpdate).toHaveBeenCalledWith(
      stagedId,
      { added: true },
      { session },
    );
  });
});
