/**
 * Sales attribution at the point of sale.
 *
 * frontDeskSubscribeToPackage takes an optional sales account. The account is
 * validated BEFORE the transaction opens — an invalid one must not leave a
 * payment or a package behind — and a valid one must reach Member.addPackage,
 * which is what writes `soldBy` onto the member's package.
 */
import { Types } from "mongoose";
import { SubscriptionsService } from "./subscriptions-service";
import Member from "../models/member";
import Package from "../models/package";
import NonUserPackage from "../models/nonUserPackage";
import User from "../models/user";
import { PaymentsService } from "./payments-service";
import { BadRequestError, NotFoundError } from "../core/ApiError";
import { runInTransaction } from "../utils/transaction";

jest.mock("../models/member");
jest.mock("../models/package", () => {
  const actual = jest.requireActual("../models/package");
  return {
    __esModule: true,
    ...actual,
    default: { findById: jest.fn() },
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

const uid = new Types.ObjectId();
const pkgId = new Types.ObjectId();
const locationId = new Types.ObjectId();
const salesAccountId = new Types.ObjectId();
const startDate = "2026-10-26T00:00:00.000Z";

const catalogPackage = {
  _id: pkgId,
  name: "Yoga Flow - 16 Classes",
  numberOfSessions: 16,
  category: "STUDIO",
  price: 1600,
  expiryPeriod: 45,
  isDeprecated: false,
};

/** Mongoose-ish query that resolves to `value` and answers .select()/.session(). */
function query(value: unknown) {
  const q = Promise.resolve(value) as Promise<unknown> & {
    select: () => unknown;
    session: () => Promise<unknown>;
    lean: () => Promise<unknown>;
  };
  q.select = () => q;
  q.session = () => Promise.resolve(value);
  q.lean = () => Promise.resolve(value);
  return q;
}

/** Sales account the sale may be credited to; override role to break it. */
function mockSalesAccount(role = "sales") {
  (User.findById as jest.Mock).mockReturnValue(
    query({ _id: salesAccountId, role }),
  );
}

function subscribe(soldBy?: string | null) {
  return SubscriptionsService.frontDeskSubscribeToPackage(
    uid.toString(),
    pkgId.toString(),
    startDate,
    "CASH",
    undefined,
    undefined,
    undefined,
    undefined,
    locationId.toString(),
    false,
    soldBy,
  );
}

/** The soldBy argument Member.addPackage was called with (10th positional). */
function soldByArg() {
  return (Member.addPackage as jest.Mock).mock.calls[0]?.[9];
}

beforeEach(() => {
  jest.clearAllMocks();
  (runInTransaction as jest.Mock).mockImplementation(
    async (fn: (session?: unknown) => Promise<unknown>) => fn(undefined),
  );
  (Member.findOne as jest.Mock).mockResolvedValue({ uid, packages: [] });
  (Member.hasPackageOnStartDay as jest.Mock).mockResolvedValue(false);
  (Member.addPackage as jest.Mock).mockResolvedValue(undefined);
  (Package.findById as jest.Mock).mockResolvedValue(catalogPackage);
  (NonUserPackage.findOne as jest.Mock).mockReturnValue(query(null));
  (User.findOne as jest.Mock).mockReturnValue(query(null));
  (PaymentsService.savePayment as jest.Mock).mockResolvedValue({
    _id: new Types.ObjectId(),
    amount: 1600,
  });
});

describe("frontDeskSubscribeToPackage — sales attribution", () => {
  it("credits the sale to the sales account the front desk picked", async () => {
    mockSalesAccount();

    await subscribe(salesAccountId.toString());

    expect(Member.addPackage).toHaveBeenCalledTimes(1);
    expect(soldByArg()).toBe(salesAccountId.toString());
  });

  it("leaves the sale uncredited when no salesperson is picked", async () => {
    await subscribe(undefined);

    expect(Member.addPackage).toHaveBeenCalledTimes(1);
    expect(soldByArg()).toBeNull();
    // No account to look up, so the sale must not query one.
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("treats an empty string as no salesperson", async () => {
    await subscribe("");

    expect(soldByArg()).toBeNull();
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("accepts a sales_manager as the seller", async () => {
    mockSalesAccount("sales_manager");

    await subscribe(salesAccountId.toString());

    expect(soldByArg()).toBe(salesAccountId.toString());
  });

  it("refuses to credit a sale to a staff account that is not a sales account", async () => {
    mockSalesAccount("branch_admin");

    await expect(subscribe(salesAccountId.toString())).rejects.toThrow(
      BadRequestError,
    );
  });

  it("refuses a malformed sales account id", async () => {
    await expect(subscribe("not-an-id")).rejects.toThrow(BadRequestError);
  });

  it("refuses a sales account id that matches no account", async () => {
    (User.findById as jest.Mock).mockReturnValue(query(null));

    await expect(subscribe(salesAccountId.toString())).rejects.toThrow(
      NotFoundError,
    );
  });

  it("takes no payment and adds no package when the salesperson is rejected", async () => {
    mockSalesAccount("coach");

    await expect(subscribe(salesAccountId.toString())).rejects.toThrow(
      BadRequestError,
    );

    // The account is validated before runInTransaction, so nothing was written.
    expect(runInTransaction).not.toHaveBeenCalled();
    expect(PaymentsService.savePayment).not.toHaveBeenCalled();
    expect(Member.addPackage).not.toHaveBeenCalled();
  });

  it("still records the branch alongside the salesperson", async () => {
    mockSalesAccount();

    await subscribe(salesAccountId.toString());

    const call = (Member.addPackage as jest.Mock).mock.calls[0];
    expect(call[8]).toBe(locationId.toString());
    expect(call[9]).toBe(salesAccountId.toString());
  });
});
