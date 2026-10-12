import { Types } from "mongoose";
import { ScanAdminService } from "./scan-admin-service";
import Member from "../models/member";
import DailyAttendance from "../models/dailyAttendance";
import ScheduledClass from "../models/scheduledClass";
import Package from "../models/package";
import User from "../models/user";
import NonUserBooking from "../models/nonUserBookings";

jest.mock("../models/member");
jest.mock("../models/dailyAttendance");
jest.mock("../models/scheduledClass");
jest.mock("../models/nonUserBookings");
// Keep the real category helpers — the service asks them what a visit costs —
// while still stubbing the model itself.
jest.mock("../models/package", () => {
  const actual = jest.requireActual("../models/package");
  return {
    __esModule: true,
    ...actual,
    default: { findById: jest.fn(), findOne: jest.fn() },
  };
});
jest.mock("../models/user");
jest.mock("../utils/transaction", () => ({
  runInTransaction: jest.fn(async (fn: (s: unknown) => Promise<unknown>) =>
    fn({} as unknown),
  ),
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const uidA = new Types.ObjectId().toString();
const uidB = new Types.ObjectId().toString();
const ptPkgId = new Types.ObjectId().toString();
const otherPkgId = new Types.ObjectId().toString();
const dayId = new Types.ObjectId().toString();
const scid = new Types.ObjectId().toString();
const rowId = new Types.ObjectId().toString();

/** Minimal stand-in for a member package subdocument. */
function makePackage(pkgId: string, remaining: number, name = "20 PT") {
  return {
    pkgId: new Types.ObjectId(pkgId),
    name,
    pkgStartDate: new Date("2026-09-01T12:00:00Z"),
    pkgEndDate: new Date("2026-12-01T12:00:00Z"),
    status: "ACTIVE",
    remainingClasses: remaining,
    adjustmentHistory: [] as any[],
  };
}

function makeMember(uid: string, packages: any[]) {
  return { uid, packages, save: jest.fn().mockResolvedValue(undefined) };
}

/** Parent document whose subdocument array behaves like a Mongoose DocumentArray. */
function makeDay(arrayPath: "ptAttendance" | "openGymAttendance", row: any) {
  const arr: any = [row];
  arr.id = (id: string) => (row._id.toString() === id ? row : null);
  arr.pull = jest.fn();
  return { _id: new Types.ObjectId(dayId), [arrayPath]: arr, save: jest.fn() };
}

function ptRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(rowId),
    uid: new Types.ObjectId(uidA),
    pkgId: new Types.ObjectId(ptPkgId),
    method: "20 PT",
    time: new Date("2026-10-10T16:00:00Z"),
    status: "SUCCESS",
    ...overrides,
  };
}

/** Both call sites read the catalog as findById(id).select(...).session(...). */
function mockCatalog(category: string, name = "20 PT") {
  const sessionFn = jest
    .fn()
    .mockResolvedValue({ _id: new Types.ObjectId(ptPkgId), category, name });
  (Package.findById as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      session: sessionFn,
    }),
    session: sessionFn,
  });
}

function mockLegacyLookup(found: string | null) {
  (Package.findOne as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      session: jest
        .fn()
        .mockResolvedValue(found ? { _id: new Types.ObjectId(found) } : null),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (Member.updateOne as jest.Mock).mockResolvedValue({ matchedCount: 1 });
  (ScheduledClass.updateOne as jest.Mock) = jest.fn().mockResolvedValue({ matchedCount: 1 });
  (ScheduledClass.bookMember as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  (ScheduledClass.removeBookedNonUser as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  (ScheduledClass.bookNonUser as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  (NonUserBooking.cancelBooking as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  mockCatalog("PERSONAL_TRAINING");
  mockLegacyLookup(null);
});

describe("ScanAdminService.deleteScanRow", () => {
  it("returns the session and clears the attendance mark for a SUCCESS PT row", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });
    const pkg = makePackage(ptPkgId, 4);
    const member = makeMember(uidA, [pkg]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });

    await ScanAdminService.deleteScanRow({
      source: "pt",
      parentId: dayId,
      rowId,
    });

    expect(pkg.remainingClasses).toBe(5);
    expect(pkg.adjustmentHistory).toHaveLength(1);
    expect(pkg.adjustmentHistory[0]).toMatchObject({
      type: "ADD",
      amount: 1,
      source: "ADMIN",
    });
    // The member's own PT attendance entry goes too, so they can re-scan today.
    expect(Member.updateOne).toHaveBeenCalledWith(
      { uid: uidA },
      expect.objectContaining({ $pull: expect.objectContaining({ ptAttendance: expect.anything() }) }),
      expect.anything(),
    );
    expect(day.ptAttendance.pull).toHaveBeenCalled();
    expect(day.save).toHaveBeenCalled();
  });

  it("leaves balances alone when the row was a FAILED scan", async () => {
    const row = ptRow({ status: "FAILED" });
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await ScanAdminService.deleteScanRow({ source: "pt", parentId: dayId, rowId });

    expect(Member.findOne).not.toHaveBeenCalled();
    expect(day.ptAttendance.pull).toHaveBeenCalled();
  });

  it("skips the refund when restoreSession is false", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await ScanAdminService.deleteScanRow(
      { source: "pt", parentId: dayId, rowId },
      { restoreSession: false },
    );

    expect(Member.findOne).not.toHaveBeenCalled();
    expect(day.ptAttendance.pull).toHaveBeenCalled();
  });

  it("does not refund an unlimited space-access package", async () => {
    mockCatalog("OPEN_GYM", "Ultimate Mindspacer");
    const row = ptRow({ method: "Ultimate Mindspacer" });
    const day = makeDay("openGymAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await ScanAdminService.deleteScanRow({
      source: "open-gym",
      parentId: dayId,
      rowId,
    });

    // Unlimited visits cost nothing, so there is no credit to give back.
    expect(Member.findOne).not.toHaveBeenCalled();
    expect(day.openGymAttendance.pull).toHaveBeenCalled();
  });

  it("drops a class attendance mark and returns session credit by default", async () => {
    const scanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const arr: any = [scanRow];
    arr.id = (id: string) => (scanRow._id.toString() === id ? scanRow : null);
    arr.pull = jest.fn();
    const cls = {
      _id: new Types.ObjectId(scid),
      scans: arr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });
    const pkg = makePackage(ptPkgId, 3, "20 Functional Training");
    const member = makeMember(uidA, [pkg]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });

    await ScanAdminService.deleteScanRow({
      source: "class",
      parentId: scid,
      rowId,
    });

    expect(Member.updateOne).toHaveBeenCalledWith(
      { uid: uidA },
      { $pull: { attendance: { scid: new Types.ObjectId(scid) } } },
      expect.anything(),
    );
    expect(ScheduledClass.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(scid) },
      { $pull: { bookedMembers: { uid: new Types.ObjectId(uidA) } } },
      expect.anything(),
    );
    expect(pkg.remainingClasses).toBe(4);
    expect(arr.pull).toHaveBeenCalled();
  });

  it("drops a class attendance mark without refunding credit when restoreSession is false", async () => {
    const scanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const arr: any = [scanRow];
    arr.id = (id: string) => (scanRow._id.toString() === id ? scanRow : null);
    arr.pull = jest.fn();
    const cls = { _id: new Types.ObjectId(scid), scans: arr, save: jest.fn() };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });

    await ScanAdminService.deleteScanRow(
      {
        source: "class",
        parentId: scid,
        rowId,
      },
      { restoreSession: false },
    );

    expect(Member.updateOne).toHaveBeenCalledWith(
      { uid: uidA },
      { $pull: { attendance: { scid: new Types.ObjectId(scid) } } },
      expect.anything(),
    );
    expect(Member.findOne).not.toHaveBeenCalled();
    expect(arr.pull).toHaveBeenCalled();
  });
});

describe("ScanAdminService.updateScanRow", () => {
  it("moves the session when the row is reassigned to another member", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    const pkgA = makePackage(ptPkgId, 4);
    const pkgB = makePackage(otherPkgId, 9, "10 PT with Zeina Tarek");
    const memberA = makeMember(uidA, [pkgA]);
    const memberB = makeMember(uidB, [pkgB]);
    (Member.findOne as jest.Mock).mockImplementation(({ uid }: { uid: string }) => ({
      session: jest.fn().mockResolvedValue(uid === uidA ? memberA : memberB),
    }));
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidB) }),
      }),
    });

    await ScanAdminService.updateScanRow(
      { source: "pt", parentId: dayId, rowId },
      { uid: uidB, pkgId: otherPkgId },
    );

    expect(pkgA.remainingClasses).toBe(5); // wrong member made whole
    expect(pkgB.remainingClasses).toBe(8); // right member charged
    expect(day.save).toHaveBeenCalled();
  });

  it("refuses a reassignment that does not say which package to charge", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await expect(
      ScanAdminService.updateScanRow(
        { source: "pt", parentId: dayId, rowId },
        { uid: uidB },
      ),
    ).rejects.toThrow(/which of the new member's packages/i);
  });

  it("returns the session when a row is flipped from SUCCESS to FAILED", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });
    const pkg = makePackage(ptPkgId, 4);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(makeMember(uidA, [pkg])),
    });

    await ScanAdminService.updateScanRow(
      { source: "pt", parentId: dayId, rowId },
      { status: "FAILED" },
    );

    expect(pkg.remainingClasses).toBe(5);
    expect(row.status).toBe("FAILED");
  });

  it("changes only the timestamp without moving any credit", async () => {
    const row = ptRow();
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await ScanAdminService.updateScanRow(
      { source: "pt", parentId: dayId, rowId },
      { time: "2026-10-10T18:30:00Z" },
    );

    expect(row.time).toEqual(new Date("2026-10-10T18:30:00Z"));
    expect(Member.findOne).not.toHaveBeenCalled();
  });

  it("rejects guest fields on a non-open-gym row", async () => {
    await expect(
      ScanAdminService.updateScanRow(
        { source: "pt", parentId: dayId, rowId },
        { guestName: "Walk In" },
      ),
    ).rejects.toThrow(/open gym/i);
  });

  it("moving a class check-in to another member returns session to original member and charges the new one", async () => {
    const scanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const arr: any = [scanRow];
    arr.id = (id: string) => (scanRow._id.toString() === id ? scanRow : null);
    const cls = {
      _id: new Types.ObjectId(scid),
      scans: arr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });

    const pkgA = makePackage(ptPkgId, 3, "20 Functional Training");
    const pkgB = makePackage(otherPkgId, 8, "10 Functional Training");
    const memberA = makeMember(uidA, [pkgA]);
    const memberB = makeMember(uidB, [pkgB]);

    (Member.findOne as jest.Mock).mockImplementation(({ uid }: { uid: string }) => ({
      session: jest.fn().mockResolvedValue(uid === uidA ? memberA : memberB),
    }));
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidB), name: "Member B" }),
      }),
    });
    mockCatalog("FUNCTIONAL_TRAINING", "10 Functional Training");

    await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId },
      { uid: uidB, pkgId: otherPkgId },
    );

    expect(pkgA.remainingClasses).toBe(4); // original member made whole (+1)
    expect(pkgB.remainingClasses).toBe(7); // new member charged (-1)
    expect(ScheduledClass.bookMember).toHaveBeenCalledWith(
      scid,
      uidB,
      expect.any(String),
      expect.anything(),
      true,
    );
  });
});

describe("ScanAdminService.moveScanToClass", () => {
  it("moves a member's check-in to a new class when member scanned a false QR code", async () => {
    const targetScid = new Types.ObjectId().toString();
    const falseScanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const falseArr: any = [falseScanRow];
    falseArr.id = (id: string) => (falseScanRow._id.toString() === id ? falseScanRow : null);
    falseArr.pull = jest.fn();
    const falseCls = {
      _id: new Types.ObjectId(scid),
      scans: falseArr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };

    const targetScansArr: any = [];
    targetScansArr.id = jest.fn((id: string) => ({
      _id: new Types.ObjectId(id),
      uid: new Types.ObjectId(uidA),
      method: "10 Pilates",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    }));
    const targetCls = {
      _id: new Types.ObjectId(targetScid),
      scans: targetScansArr,
      bookedMembers: [],
      save: jest.fn(),
    };

    (ScheduledClass.findById as jest.Mock).mockImplementation((id: Types.ObjectId | string) => {
      const idStr = id.toString();
      const cls = idStr === scid ? falseCls : targetCls;
      return {
        session: jest.fn().mockResolvedValue(cls),
      };
    });

    const pkgA = makePackage(ptPkgId, 3, "20 Functional Training");
    const pkgTarget = makePackage(otherPkgId, 5, "10 Pilates");
    const member = makeMember(uidA, [pkgA, pkgTarget]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidA), name: "Member A" }),
      }),
    });
    mockCatalog("PILATES", "10 Pilates");

    const result = await ScanAdminService.moveScanToClass(
      { source: "class", parentId: scid, rowId },
      targetScid,
      { pkgId: otherPkgId },
    );

    expect(pkgA.remainingClasses).toBe(4); // false class session returned (+1)
    expect(pkgTarget.remainingClasses).toBe(4); // new class session charged (-1)
    expect(falseArr.pull).toHaveBeenCalled();
    expect(targetCls.scans).toHaveLength(1);
    expect(ScheduledClass.bookMember).toHaveBeenCalledWith(
      targetScid,
      uidA,
      expect.any(String),
      expect.anything(),
      true,
    );
    expect(result.parentId).toBe(targetScid);
  });

  it("does not charge twice if member is already booked in the target class", async () => {
    const targetScid = new Types.ObjectId().toString();
    const falseScanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const falseArr: any = [falseScanRow];
    falseArr.id = (id: string) => (falseScanRow._id.toString() === id ? falseScanRow : null);
    falseArr.pull = jest.fn();
    const falseCls = {
      _id: new Types.ObjectId(scid),
      scans: falseArr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };

    const targetScansArr: any = [];
    targetScansArr.id = jest.fn((id: string) => ({
      _id: new Types.ObjectId(id),
      uid: new Types.ObjectId(uidA),
      method: "10 Pilates",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    }));
    const targetCls = {
      _id: new Types.ObjectId(targetScid),
      scans: targetScansArr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "10 Pilates" }], // already booked!
      save: jest.fn(),
    };

    (ScheduledClass.findById as jest.Mock).mockImplementation((id: Types.ObjectId | string) => {
      const idStr = id.toString();
      const cls = idStr === scid ? falseCls : targetCls;
      return {
        session: jest.fn().mockResolvedValue(cls),
      };
    });

    const pkgA = makePackage(ptPkgId, 3, "20 Functional Training");
    const pkgTarget = makePackage(otherPkgId, 5, "10 Pilates");
    const member = makeMember(uidA, [pkgA, pkgTarget]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidA), name: "Member A" }),
      }),
    });
    mockCatalog("PILATES", "10 Pilates");

    await ScanAdminService.moveScanToClass(
      { source: "class", parentId: scid, rowId },
      targetScid,
      { pkgId: otherPkgId },
    );

    expect(pkgA.remainingClasses).toBe(4); // false class session returned (+1)
    expect(pkgTarget.remainingClasses).toBe(5); // not charged twice!
    expect(targetCls.scans).toHaveLength(1);
  });

  it("moves a scan to a new class and reassigns member, refunding old and charging new", async () => {
    const targetScid = new Types.ObjectId().toString();
    const falseScanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const falseArr: any = [falseScanRow];
    falseArr.id = (id: string) => (falseScanRow._id.toString() === id ? falseScanRow : null);
    falseArr.pull = jest.fn();
    const falseCls = {
      _id: new Types.ObjectId(scid),
      scans: falseArr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };

    const targetScansArr: any = [];
    targetScansArr.id = jest.fn((id: string) => ({
      _id: new Types.ObjectId(id),
      uid: new Types.ObjectId(uidB),
      method: "10 Pilates",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    }));
    const targetCid = new Types.ObjectId();
    const targetCls = {
      _id: new Types.ObjectId(targetScid),
      cid: targetCid,
      scans: targetScansArr,
      bookedMembers: [],
      save: jest.fn(),
    };

    (ScheduledClass.findById as jest.Mock).mockImplementation((id: Types.ObjectId | string) => {
      const idStr = id.toString();
      const cls = idStr === scid ? falseCls : targetCls;
      return {
        session: jest.fn().mockResolvedValue(cls),
      };
    });

    const pkgA = makePackage(ptPkgId, 3, "20 Functional Training");
    const pkgB = makePackage(otherPkgId, 5, "10 Pilates");
    (Member.findOne as jest.Mock).mockImplementation(({ uid }: { uid: string }) => {
      const member = uid === uidA ? makeMember(uidA, [pkgA]) : makeMember(uidB, [pkgB]);
      return {
        session: jest.fn().mockResolvedValue(member),
      };
    });
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidB), name: "Member B" }),
      }),
    });
    const sessionFn = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(otherPkgId),
      category: "PILATES",
      name: "10 Pilates",
      opensClasses: [targetCid],
    });
    (Package.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ session: sessionFn }),
      session: sessionFn,
    });

    await ScanAdminService.moveScanToClass(
      { source: "class", parentId: scid, rowId },
      targetScid,
      { uid: uidB, pkgId: otherPkgId },
    );

    expect(pkgA.remainingClasses).toBe(4); // Member A got session refunded (+1)
    expect(pkgB.remainingClasses).toBe(4); // Member B got session charged (-1)
    expect(targetCls.scans).toHaveLength(1);
  });

  it("refuses to move a scan if package does not open target class", async () => {
    const targetScid = new Types.ObjectId().toString();
    const targetCid = new Types.ObjectId();
    const otherClassCid = new Types.ObjectId();

    const falseScanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const falseArr: any = [falseScanRow];
    falseArr.id = (id: string) => (falseScanRow._id.toString() === id ? falseScanRow : null);
    falseArr.pull = jest.fn();
    const falseCls = {
      _id: new Types.ObjectId(scid),
      scans: falseArr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };
    const targetCls = {
      _id: new Types.ObjectId(targetScid),
      cid: targetCid,
      scans: [],
      bookedMembers: [],
      save: jest.fn(),
    };

    (ScheduledClass.findById as jest.Mock).mockImplementation((id: Types.ObjectId | string) => {
      const idStr = id.toString();
      const cls = idStr === scid ? falseCls : targetCls;
      return {
        session: jest.fn().mockResolvedValue(cls),
      };
    });

    const sessionFn = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(otherPkgId),
      category: "PILATES",
      name: "10 Pilates",
      opensClasses: [otherClassCid], // does NOT include targetCid
    });
    (Package.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ session: sessionFn }),
      session: sessionFn,
    });

    await expect(
      ScanAdminService.moveScanToClass(
        { source: "class", parentId: scid, rowId },
        targetScid,
        { pkgId: otherPkgId },
      ),
    ).rejects.toThrow(/Selected package does not cover this class/i);
  });

  it("refuses to move a scan to the same class", async () => {
    await expect(
      ScanAdminService.moveScanToClass(
        { source: "class", parentId: scid, rowId },
        scid,
      ),
    ).rejects.toThrow(/same class/i);
  });
});

describe("ScanAdminService legacy rows", () => {
  it("resolves the package by name so an old row still refunds", async () => {
    // Rows recorded before pkgId was stored carry only the package name.
    mockLegacyLookup(ptPkgId);
    const row = ptRow({ pkgId: undefined });
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });
    const pkg = makePackage(ptPkgId, 4);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(makeMember(uidA, [pkg])),
    });

    await ScanAdminService.deleteScanRow({ source: "pt", parentId: dayId, rowId });

    expect(Package.findOne).toHaveBeenCalledWith({ name: "20 PT" });
    expect(pkg.remainingClasses).toBe(5);
  });

  it("still removes the row when the package name matches nothing", async () => {
    const row = ptRow({ pkgId: undefined, method: "Deleted Package" });
    const day = makeDay("ptAttendance", row);
    (DailyAttendance.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(day),
    });

    await ScanAdminService.deleteScanRow({ source: "pt", parentId: dayId, rowId });

    expect(day.ptAttendance.pull).toHaveBeenCalled();
    expect(Member.findOne).not.toHaveBeenCalled();
  });
});

describe("ScanAdminService WILL_PAY status transitions", () => {
  it("returns the session when a row is flipped from SUCCESS to WILL_PAY", async () => {
    const scanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: true,
    };
    const arr: any = [scanRow];
    arr.id = (id: string) => (scanRow._id.toString() === id ? scanRow : null);
    const cls = {
      _id: new Types.ObjectId(scid),
      scans: arr,
      bookedMembers: [{ uid: new Types.ObjectId(uidA), method: "20 Functional Training" }],
      save: jest.fn(),
    };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });
    const pkg = makePackage(ptPkgId, 3, "20 Functional Training");
    const member = makeMember(uidA, [pkg]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });

    const updated = await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId },
      { status: "WILL_PAY" },
    );

    // Reverting SUCCESS refunds credit and clears attendance
    expect(pkg.remainingClasses).toBe(4);
    expect(scanRow.status).toBe("WILL_PAY");
    expect(updated.status).toBe("WILL_PAY");
  });

  it("charges the session when a row is flipped from WILL_PAY to SUCCESS", async () => {
    const scanRow = {
      _id: new Types.ObjectId(rowId),
      uid: new Types.ObjectId(uidA),
      pkgId: new Types.ObjectId(ptPkgId),
      method: "20 Functional Training",
      scanTime: new Date("2026-10-10T16:00:00Z"),
      status: "WILL_PAY",
    };
    const arr: any = [scanRow];
    arr.id = (id: string) => (scanRow._id.toString() === id ? scanRow : null);
    const cls = {
      _id: new Types.ObjectId(scid),
      cid: new Types.ObjectId(),
      scans: arr,
      bookedMembers: [],
      save: jest.fn(),
    };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });
    const pkg = makePackage(ptPkgId, 5, "20 Functional Training");
    const member = makeMember(uidA, [pkg]);
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(member),
    });

    const updated = await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId },
      { status: "SUCCESS" },
    );

    expect(pkg.remainingClasses).toBe(4);
    expect(scanRow.status).toBe(true);
    expect(updated.status).toBe("SUCCESS");
  });
});

describe("ScanAdminService walk-in NonUserBooking", () => {
  const walkInId = new Types.ObjectId().toString();

  function makeWalkIn(overrides: Record<string, any> = {}) {
    return {
      _id: new Types.ObjectId(walkInId),
      scid: new Types.ObjectId(scid),
      name: "Guest Jane",
      phoneNumber: "01011112222",
      bookingTime: new Date("2026-10-10T14:00:00Z"),
      attendanceTime: new Date("2026-10-10T14:30:00Z"),
      status: "ATTENDED",
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function mockClassWithoutRow() {
    const arr: any = [];
    arr.id = jest.fn().mockReturnValue(null);
    const cls = {
      _id: new Types.ObjectId(scid),
      cid: new Types.ObjectId(),
      scans: arr,
      bookedMembers: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    (ScheduledClass.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(cls),
    });
    return cls;
  }

  it("gets a walk-in scan row with guest details and WILL_PAY status", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn();
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    const row = await ScanAdminService.getScanRow({
      source: "class",
      parentId: scid,
      rowId: walkInId,
    });

    expect(row.guestName).toBe("Guest Jane");
    expect(row.guestPhone).toBe("01011112222");
    expect(row.method).toBe("Walk In");
    expect(row.status).toBe("WILL_PAY");
  });

  it("updates walk-in guest details and attendance time", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn();
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    const updated = await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId: walkInId },
      { guestName: "Jane Smith", guestPhone: "01099998888" },
    );

    expect(walkIn.name).toBe("Jane Smith");
    expect(walkIn.phoneNumber).toBe("01099998888");
    expect(walkIn.save).toHaveBeenCalled();
  });

  it("cancels walk-in and restores class slot when status changed to FAILED", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn({ status: "ATTENDED" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId: walkInId },
      { status: "FAILED" },
    );

    expect(walkIn.status).toBe("CANCELLED");
    expect(ScheduledClass.removeBookedNonUser).toHaveBeenCalledWith(scid, expect.anything());
    expect(walkIn.save).toHaveBeenCalled();
  });

  it("deleting a walk-in cancels the booking and frees class slot", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn({ status: "ATTENDED" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    await ScanAdminService.deleteScanRow({
      source: "class",
      parentId: scid,
      rowId: walkInId,
    });

    expect(NonUserBooking.cancelBooking).toHaveBeenCalledWith(walkInId, expect.anything());
    expect(ScheduledClass.removeBookedNonUser).toHaveBeenCalledWith(scid, expect.anything());
  });

  it("reassigns walk-in to a member: cancels walk-in, charges member package, creates scan", async () => {
    const cls = mockClassWithoutRow();
    const walkIn = makeWalkIn({ status: "ATTENDED" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });
    (User.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(uidB), name: "Member Bob" }),
      }),
    });
    const pkg = makePackage(ptPkgId, 3, "Class Package");
    (Package.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(ptPkgId), name: "Class Package", opensClasses: [] }),
      }),
    });
    (Member.findOne as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(makeMember(uidB, [pkg])),
    });

    await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId: walkInId },
      { uid: uidB, pkgId: ptPkgId, status: "SUCCESS" },
    );

    expect(NonUserBooking.cancelBooking).toHaveBeenCalledWith(walkInId, expect.anything());
    expect(ScheduledClass.removeBookedNonUser).toHaveBeenCalledWith(scid, expect.anything());
    expect(pkg.remainingClasses).toBe(2);
    expect(cls.scans.length).toBe(1);
    expect(cls.scans[0].uid.toString()).toBe(uidB);
    expect(cls.save).toHaveBeenCalled();
  });

  it("moves walk-in to another class as walk-in: transfers slot and updates scid", async () => {
    const cls = mockClassWithoutRow();
    const targetScid = new Types.ObjectId().toString();
    const targetCls = {
      _id: new Types.ObjectId(targetScid),
      cid: new Types.ObjectId(),
      scans: [],
      bookedMembers: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    (ScheduledClass.findById as jest.Mock).mockImplementation((id: any) => {
      const idStr = id?.toString() || String(id);
      return {
        session: jest.fn().mockResolvedValue(idStr === targetScid ? targetCls : cls),
      };
    });
    const walkIn = makeWalkIn({ status: "ATTENDED" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    await ScanAdminService.moveScanToClass(
      { source: "class", parentId: scid, rowId: walkInId },
      targetScid,
    );

    expect(ScheduledClass.removeBookedNonUser).toHaveBeenCalledWith(scid, expect.anything());
    expect(ScheduledClass.bookNonUser).toHaveBeenCalledWith(targetScid, expect.anything(), true);
    expect(walkIn.scid.toString()).toBe(targetScid);
    expect(walkIn.save).toHaveBeenCalled();
  });

  it("reads an FOC walk-in row with Invitation method and FOC status", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn({ status: "FOC" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    const row = await ScanAdminService.getScanRow({
      source: "class",
      parentId: scid,
      rowId: walkInId,
    });

    expect(row.guestName).toBe("Guest Jane");
    expect(row.method).toBe("Invitation");
    expect(row.status).toBe("FOC");
  });

  it("updates walk-in status to FOC without creating a payment record", async () => {
    mockClassWithoutRow();
    const walkIn = makeWalkIn({ status: "ATTENDED" });
    (NonUserBooking.findById as jest.Mock).mockReturnValue({
      session: jest.fn().mockResolvedValue(walkIn),
    });

    await ScanAdminService.updateScanRow(
      { source: "class", parentId: scid, rowId: walkInId },
      { status: "FOC" },
    );

    expect(walkIn.status).toBe("FOC");
    expect(walkIn.save).toHaveBeenCalled();
  });
});
