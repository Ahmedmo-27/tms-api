import { Types } from "mongoose";
import Member from "../models/member";
import Package from "../models/package";
import ScheduledClass from "../models/scheduledClass";
import { ForbiddenError } from "../core/ApiError";

describe("Ultimate Mindspacer Max Booked Suite", () => {
  const uid = new Types.ObjectId().toString();
  const catalogPkgId = new Types.ObjectId();
  const cid = new Types.ObjectId().toString();

  const pkgStartDate = new Date("2026-01-01T12:00:00.000Z");
  const pkgEndDate = new Date("2026-12-31T12:00:00.000Z");

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows booking when member has fewer than 3 unattended bookings", async () => {
    const scid1 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
      ],
      attendance: [],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "1 Month Ultimate Mindspacer",
          remainingClasses: 10000,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "ULTIMATE_MINDSPACER", name: "1 Month Ultimate Mindspacer" },
      ]),
    } as any);

    jest.spyOn(ScheduledClass, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([
          { _id: scid1, startTime: new Date(Date.now() + 86400000) },
        ]),
      }),
    } as any);

    jest.spyOn(Member, "updateOne").mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as any);

    jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

    const result = await Member.saveBooking(
      uid,
      [catalogPkgId.toString()],
      scidToBook,
      false,
      false,
      cid,
      "112026",
      1,
      {} as any,
      "Strength & Conditioning",
      new Date(),
      "member",
    );

    expect(result).toBe(catalogPkgId.toString());
  });

  it("blocks booking when member already has 3 unattended bookings under Ultimate Mindspacer", async () => {
    const scid1 = new Types.ObjectId();
    const scid2 = new Types.ObjectId();
    const scid3 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
        { scid: scid2, bookingTime: new Date() },
        { scid: scid3, bookingTime: new Date() },
      ],
      attendance: [],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "1 Month Ultimate Mindspacer",
          remainingClasses: 10000,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "ULTIMATE_MINDSPACER", name: "1 Month Ultimate Mindspacer" },
      ]),
    } as any);

    jest.spyOn(ScheduledClass, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([
          { _id: scid1, startTime: new Date(Date.now() + 86400000) },
          { _id: scid2, startTime: new Date(Date.now() + 172800000) },
          { _id: scid3, startTime: new Date(Date.now() + 259200000) },
        ]),
      }),
    } as any);

    const updateOneSpy = jest.spyOn(Member, "updateOne");

    let err: any = null;
    try {
      await Member.saveBooking(
        uid,
        [catalogPkgId.toString()],
        scidToBook,
        false,
        false,
        cid,
        "112026",
        1,
        {} as any,
        "Strength & Conditioning",
        new Date(),
        "member",
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe("MAX_BOOKINGS_REACHED");
    expect(err.message).toContain("You cannot have more than 3 booked classes without attending");
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("allows booking if at least 1 of the 3 existing bookings has been attended", async () => {
    const scid1 = new Types.ObjectId();
    const scid2 = new Types.ObjectId();
    const scid3 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
        { scid: scid2, bookingTime: new Date() },
        { scid: scid3, bookingTime: new Date() },
      ],
      attendance: [
        { scid: scid1 }, // Class 1 has been attended!
      ],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "1 Month Ultimate Mindspacer",
          remainingClasses: 10000,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "ULTIMATE_MINDSPACER", name: "1 Month Ultimate Mindspacer" },
      ]),
    } as any);

    jest.spyOn(ScheduledClass, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([
          { _id: scid1, startTime: new Date(Date.now() + 86400000) },
          { _id: scid2, startTime: new Date(Date.now() + 172800000) },
          { _id: scid3, startTime: new Date(Date.now() + 259200000) },
        ]),
      }),
    } as any);

    jest.spyOn(Member, "updateOne").mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as any);

    jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

    const result = await Member.saveBooking(
      uid,
      [catalogPkgId.toString()],
      scidToBook,
      false,
      false,
      cid,
      "112026",
      1,
      {} as any,
      "Strength & Conditioning",
      new Date(),
      "member",
    );

    expect(result).toBe(catalogPkgId.toString());
  });

  it("respects custom maxBooked variable set on package (e.g. maxBooked: 2)", async () => {
    const scid1 = new Types.ObjectId();
    const scid2 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
        { scid: scid2, bookingTime: new Date() },
      ],
      attendance: [],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "VIP Package",
          remainingClasses: 100,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "FUNCTIONAL_TRAINING", name: "VIP Package", maxBooked: 2 },
      ]),
    } as any);

    jest.spyOn(ScheduledClass, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([
          { _id: scid1, startTime: new Date(Date.now() + 86400000) },
          { _id: scid2, startTime: new Date(Date.now() + 172800000) },
        ]),
      }),
    } as any);

    let err: any = null;
    try {
      await Member.saveBooking(
        uid,
        [catalogPkgId.toString()],
        scidToBook,
        false,
        false,
        cid,
        "112026",
        1,
        {} as any,
        "Strength & Conditioning",
        new Date(),
        "member",
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe("MAX_BOOKINGS_REACHED");
    expect(err.message).toContain("You cannot have more than 2 booked classes without attending");
  });

  it("allows admin override (isAdminOverride: true) to bypass the maxBooked limit", async () => {
    const scid1 = new Types.ObjectId();
    const scid2 = new Types.ObjectId();
    const scid3 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
        { scid: scid2, bookingTime: new Date() },
        { scid: scid3, bookingTime: new Date() },
      ],
      attendance: [],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "1 Month Ultimate Mindspacer",
          remainingClasses: 10000,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "ULTIMATE_MINDSPACER", name: "1 Month Ultimate Mindspacer" },
      ]),
    } as any);

    jest.spyOn(Member, "updateOne").mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as any);

    jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

    const result = await Member.saveBooking(
      uid,
      [catalogPkgId.toString()],
      scidToBook,
      false,
      false,
      cid,
      "112026",
      1,
      {} as any,
      "Strength & Conditioning",
      new Date(),
      "admin",
      true, // isAdminOverride = true
    );

    expect(result).toBe(catalogPkgId.toString());
  });

  it("does not restrict finite standard packages (e.g. 10 Functional Training) without maxBooked", async () => {
    const scid1 = new Types.ObjectId();
    const scid2 = new Types.ObjectId();
    const scid3 = new Types.ObjectId();
    const scidToBook = new Types.ObjectId().toString();

    const mockMember: any = {
      uid: new Types.ObjectId(uid),
      bookings: [
        { scid: scid1, bookingTime: new Date() },
        { scid: scid2, bookingTime: new Date() },
        { scid: scid3, bookingTime: new Date() },
      ],
      attendance: [],
      packages: [
        {
          pkgId: catalogPkgId,
          name: "10 Functional Training",
          remainingClasses: 7,
          pkgStartDate,
          pkgEndDate,
          status: "ACTIVE",
        },
      ],
    };

    jest.spyOn(Member, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue(mockMember),
    } as any);

    jest.spyOn(Package, "find").mockReturnValue({
      session: jest.fn().mockResolvedValue([
        { _id: catalogPkgId, category: "FUNCTIONAL_TRAINING", name: "10 Functional Training" },
      ]),
    } as any);

    jest.spyOn(Member, "updateOne").mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    } as any);

    jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

    const result = await Member.saveBooking(
      uid,
      [catalogPkgId.toString()],
      scidToBook,
      false,
      false,
      cid,
      "112026",
      1,
      {} as any,
      "Strength & Conditioning",
      new Date(),
      "member",
    );

    expect(result).toBe(catalogPkgId.toString());
  });
});
