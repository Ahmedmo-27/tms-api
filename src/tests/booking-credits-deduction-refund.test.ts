import { Types } from "mongoose";
import Member from "../models/member";
import Package from "../models/package";
import { ForbiddenError } from "../core/ApiError";
import { selectEligiblePackage } from "../utils/package-eligibility";

describe("Booking Credits Deduction & Cancellation Refund Suite", () => {
  const uid = new Types.ObjectId().toString();
  const scid = new Types.ObjectId().toString();
  const cid = new Types.ObjectId().toString();
  const catalogPkgId = new Types.ObjectId();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("1. Member.saveBooking - Multi-Credit Balance Validation & Atomicity", () => {
    it("rejects booking when active package has only 1 credit remaining and class requires 2 credits", async () => {
      const pkgStartDate = new Date("2026-09-01T12:00:00.000Z");
      const pkgEndDate = new Date("2026-12-01T12:00:00.000Z");

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 1, // Only 1 credit left!
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
          { _id: catalogPkgId, category: "STUDIO" },
        ]),
      } as any);

      const updateOneSpy = jest.spyOn(Member, "updateOne").mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      } as any);

      let caughtError: any = null;
      try {
        await Member.saveBooking(
          uid,
          [catalogPkgId.toString()],
          scid,
          false,
          false,
          cid,
          "92026",
          2, // Class requires 2 credits (Reformer Pilates)
          {} as any,
          "Reformer Pilates",
          new Date(),
          "member"
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ForbiddenError);
      expect(caughtError.code).toBe("NO_REMAINING_SESSIONS");
      // updateOne should not have pushed a booking or decremented remainingClasses
      expect(updateOneSpy).not.toHaveBeenCalled();
    });

    it("allows booking when active package has 2 credits and class requires 2 credits, pushing pkgId and pkgStartDate", async () => {
      const pkgStartDate = new Date("2026-09-01T12:00:00.000Z");
      const pkgEndDate = new Date("2026-12-01T12:00:00.000Z");

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 2,
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
          { _id: catalogPkgId, category: "STUDIO" },
        ]),
      } as any);

      const updateOneSpy = jest.spyOn(Member, "updateOne").mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);

      const pushRecordSpy = jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

      const result = await Member.saveBooking(
        uid,
        [catalogPkgId.toString()],
        scid,
        false,
        false,
        cid,
        "92026",
        2, // 2 credits
        {} as any,
        "Reformer Pilates",
        new Date(),
        "member"
      );

      expect(result).toBe(catalogPkgId.toString());

      // Verify booking update operation included pkgId and pkgStartDate
      expect(updateOneSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          uid,
          "bookings.scid": { $ne: new Types.ObjectId(scid) },
          packages: expect.objectContaining({
            $elemMatch: expect.objectContaining({
              pkgId: catalogPkgId,
              pkgStartDate: expect.any(Date),
              remainingClasses: { $gte: 2 },
            }),
          }),
        }),
        expect.objectContaining({
          $push: {
            bookings: expect.objectContaining({
              scid: new Types.ObjectId(scid),
              pkgId: catalogPkgId,
              pkgStartDate: expect.any(Date),
            }),
          },
          $inc: { "packages.$[pkg].remainingClasses": -2 },
        }),
        expect.any(Object)
      );

      expect(pushRecordSpy).toHaveBeenCalledWith(
        uid,
        catalogPkgId.toString(),
        pkgStartDate,
        expect.objectContaining({
          type: "DEDUCT",
          amount: 2,
          className: "Reformer Pilates",
        }),
        expect.anything()
      );
    });

    it("allows booking 1-credit Mat Pilates when member has 1 credit remaining", async () => {
      const pkgStartDate = new Date("2026-09-01T12:00:00.000Z");
      const pkgEndDate = new Date("2026-12-01T12:00:00.000Z");

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [],
        packages: [
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 1,
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
          { _id: catalogPkgId, category: "STUDIO" },
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
        scid,
        false,
        false,
        cid,
        "92026",
        1, // 1 credit
        {} as any,
        "Mat Pilates",
        new Date(),
        "member"
      );

      expect(result).toBe(catalogPkgId.toString());
    });
  });

  describe("2. Member.removeBooking - Multi-Credit Refund & Package Isolation", () => {
    it("returns points=2 when cancelling a 2-credit Reformer Pilates class", async () => {
      const pkgStartDate = new Date("2026-09-01T12:00:00.000Z");
      const pkgEndDate = new Date("2026-12-01T12:00:00.000Z");

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [
          {
            scid: new Types.ObjectId(scid),
            bookingTime: new Date(),
            isDropIn: false,
            pkgId: catalogPkgId,
            pkgStartDate,
          },
        ],
        packages: [
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 4,
            pkgStartDate,
            pkgEndDate,
            status: "ACTIVE",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      const findOneAndUpdateSpy = jest.spyOn(Member, "findOneAndUpdate").mockResolvedValue(mockMember as any);
      const pushRecordSpy = jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

      await Member.removeBooking(
        uid,
        scid,
        [catalogPkgId.toString()],
        true, // isDeducted
        {} as any,
        cid,
        "92026",
        "MEMBER_CANCELLATION",
        "Reformer Pilates",
        2, // points = 2
        new Date()
      );

      // Verify findOneAndUpdate refunded 2 credits on the targeted package
      expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
        {
          uid,
          "bookings.scid": { $eq: new Types.ObjectId(scid) },
        },
        expect.objectContaining({
          $pull: { bookings: { scid: new Types.ObjectId(scid) } },
          $inc: { "packages.$[pkg].remainingClasses": 2 },
          $set: { "packages.$[pkg].status": "ACTIVE" },
        }),
        expect.objectContaining({
          arrayFilters: [
            {
              "pkg.pkgId": catalogPkgId,
              "pkg.pkgStartDate": pkgStartDate,
            },
          ],
        })
      );

      // Verify adjustment record recorded amount: 2
      expect(pushRecordSpy).toHaveBeenCalledWith(
        uid,
        catalogPkgId.toString(),
        pkgStartDate,
        expect.objectContaining({
          type: "ADD",
          amount: 2,
          className: "Reformer Pilates",
        }),
        expect.anything()
      );
    });

    it("refunds exclusively to the active package and never resurrects or credits an older expired package with the same catalog ID", async () => {
      const expiredStart = new Date("2026-03-01T12:00:00.000Z");
      const expiredEnd = new Date("2026-05-01T12:00:00.000Z");
      const activeStart = new Date("2026-09-01T12:00:00.000Z");
      const activeEnd = new Date("2026-12-01T12:00:00.000Z");

      const mockMember: any = {
        uid: new Types.ObjectId(uid),
        bookings: [
          {
            scid: new Types.ObjectId(scid),
            bookingTime: new Date(),
            isDropIn: false,
            pkgId: catalogPkgId,
            pkgStartDate: activeStart, // booked on the active package
          },
        ],
        packages: [
          // Index 0: Older expired package sharing the same catalogPkgId
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 0,
            pkgStartDate: expiredStart,
            pkgEndDate: expiredEnd,
            status: "EXPIRED",
          },
          // Index 1: Active package
          {
            pkgId: catalogPkgId,
            name: "10 Studio",
            remainingClasses: 2,
            pkgStartDate: activeStart,
            pkgEndDate: activeEnd,
            status: "ACTIVE",
          },
        ],
      };

      jest.spyOn(Member, "findOne").mockReturnValue({
        session: jest.fn().mockResolvedValue(mockMember),
      } as any);

      const findOneAndUpdateSpy = jest.spyOn(Member, "findOneAndUpdate").mockResolvedValue(mockMember as any);
      const pushRecordSpy = jest.spyOn(Member, "pushAdjustmentRecord").mockResolvedValue(undefined as any);

      await Member.removeBooking(
        uid,
        scid,
        [catalogPkgId.toString()],
        true,
        {} as any,
        cid,
        "92026",
        "MEMBER_CANCELLATION",
        "Reformer Pilates",
        2,
        new Date()
      );

      // Array filters MUST target activeStart, NOT expiredStart
      expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          arrayFilters: [
            {
              "pkg.pkgId": catalogPkgId,
              "pkg.pkgStartDate": activeStart,
            },
          ],
        })
      );

      // Adjustment record must be pushed to activeStart, NOT expiredStart
      expect(pushRecordSpy).toHaveBeenCalledWith(
        uid,
        catalogPkgId.toString(),
        activeStart,
        expect.objectContaining({
          type: "ADD",
          amount: 2,
        }),
        expect.anything()
      );
    });
  });

  describe("3. selectEligiblePackage - Multi-Credit Preview Support", () => {
    it("skips packages with remainingClasses < points needed", () => {
      const result = selectEligiblePackage({
        packages: [
          {
            pkgId: catalogPkgId.toString(),
            name: "10 Studio",
            remainingClasses: 1,
            pkgStartDate: new Date("2026-09-01"),
            pkgEndDate: new Date("2026-12-01"),
            status: "ACTIVE",
          },
        ],
        allowedPkgIds: [catalogPkgId.toString()],
        points: 2, // requires 2 credits
      });

      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("NO_REMAINING_SESSIONS");
    });

    it("selects package when remainingClasses >= points", () => {
      const result = selectEligiblePackage({
        packages: [
          {
            pkgId: catalogPkgId.toString(),
            name: "10 Studio",
            remainingClasses: 2,
            pkgStartDate: new Date("2026-09-01"),
            pkgEndDate: new Date("2026-12-01"),
            status: "ACTIVE",
          },
        ],
        allowedPkgIds: [catalogPkgId.toString()],
        points: 2,
      });

      expect(result.ok).toBe(true);
      expect((result as any).pkg?.name).toBe("10 Studio");
    });
  });
});
