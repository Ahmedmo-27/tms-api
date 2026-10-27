import { Types } from "mongoose";
import { CoachService } from "../services/coach-service";
import Coach from "../models/coach";
import User from "../models/user";
import Class from "../models/class";
import ScheduledClass from "../models/scheduledClass";
import NonUserBooking from "../models/nonUserBookings";
import Package from "../models/package";
import Location from "../models/location";

jest.mock("../models/coach");
jest.mock("../models/user");
jest.mock("../models/class");
jest.mock("../models/scheduledClass");
jest.mock("../models/nonUserBookings");
jest.mock("../models/package");
jest.mock("../models/location");

function mockUserFindById(userDoc: any) {
  const query: any = {
    select: jest.fn().mockImplementation((fields?: string) => Promise.resolve(userDoc)),
    then: (resolve: any, reject?: any) => Promise.resolve(userDoc).then(resolve, reject),
  };
  (User.findById as jest.Mock).mockReturnValue(query);
  return query;
}

function mockClassFindResult(results: any[]) {
  const query: any = {
    select: jest.fn().mockImplementation(() => Promise.resolve(results)),
    then: (resolve: any, reject?: any) => Promise.resolve(results).then(resolve, reject),
  };
  return query;
}

describe("Managing Coach Scans Monitor Access by Category", () => {
  const hanaAbazaDocId = new Types.ObjectId("69e6764f28c5113f3b4e6f51");
  const hanaAbazaUserId = new Types.ObjectId("6a2e4ab4df68bd7a2cf2163a");

  const hanaRashwanDocId = new Types.ObjectId("69e6765128c5113f3b4e6f69");
  const hanaRashwanUserId = new Types.ObjectId("69e88f6554d83d6549339c53");

  const otherCoachDocId = new Types.ObjectId();
  const otherCoachUserId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCoachExtraScansCategories", () => {
    it("returns FUNCTIONAL_TRAINING for Hana Abaza by name/email/id", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaAbazaDocId,
        coachName: "Hana Abaza",
        phoneNumber: "01222161664",
        userId: hanaAbazaUserId,
      });
      mockUserFindById({
        _id: hanaAbazaUserId,
        name: "Hana Abaza",
        email: "hhanaabaza@gmail.com",
        role: "managing_coach",
      });

      const categories = await CoachService.getCoachExtraScansCategories(hanaAbazaDocId, hanaAbazaUserId);
      expect(categories).toEqual(["FUNCTIONAL_TRAINING"]);
    });

    it("returns STUDIO for Hana Rashwan by name/email/id", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaRashwanDocId,
        coachName: "Hana Rashwan",
        phoneNumber: "01001061010",
        userId: hanaRashwanUserId,
      });
      mockUserFindById({
        _id: hanaRashwanUserId,
        name: "Hana Rashwan",
        email: "hanarashwan@aucegypt.edu",
        role: "managing_coach",
      });

      const categories = await CoachService.getCoachExtraScansCategories(hanaRashwanDocId, hanaRashwanUserId);
      expect(categories).toEqual(["STUDIO"]);
    });

    it("returns explicit DB scansCategories if configured on coach document", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: otherCoachDocId,
        coachName: "Coach Custom",
        scansCategories: ["WORKSPACE"],
      });
      mockUserFindById(null);

      const categories = await CoachService.getCoachExtraScansCategories(otherCoachDocId);
      expect(categories).toEqual(["WORKSPACE"]);
    });

    it("returns empty array for regular coach without extra categories", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: otherCoachDocId,
        coachName: "Omar Adel",
        phoneNumber: "01099998888",
        userId: otherCoachUserId,
      });
      mockUserFindById({
        _id: otherCoachUserId,
        name: "Omar Adel",
        email: "omar@themindspace.com",
        role: "coach",
      });

      const categories = await CoachService.getCoachExtraScansCategories(otherCoachDocId, otherCoachUserId);
      expect(categories).toEqual([]);
    });
  });

  describe("getScans with extra category access", () => {
    it("includes all FUNCTIONAL_TRAINING classes when viewed by Hana Abaza", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaAbazaDocId,
        coachName: "Hana Abaza",
        phoneNumber: "01222161664",
        userId: hanaAbazaUserId,
      });
      mockUserFindById({
        _id: hanaAbazaUserId,
        name: "Hana Abaza",
        role: "managing_coach",
      });

      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const ftClassId = new Types.ObjectId();
      const ftClassDoc = {
        _id: ftClassId,
        title: "Conditioning (Circuit)",
        category: "FUNCTIONAL_TRAINING",
      };

      (Class.find as jest.Mock).mockImplementation((query: any) => {
        if (query?.category) {
          return mockClassFindResult([ftClassDoc]);
        }
        if (query?._id?.$in) {
          return mockClassFindResult([ftClassDoc]);
        }
        return mockClassFindResult([]);
      });

      const otherCoachId = new Types.ObjectId();
      const scheduledClassDoc = {
        _id: new Types.ObjectId(),
        cid: ftClassId,
        locationId: new Types.ObjectId(),
        coachId: [{ _id: otherCoachId, coachName: "Omar Adel" }],
        startTime: new Date("2026-10-27T08:00:00.000Z"),
        endTime: new Date("2026-10-27T09:00:00.000Z"),
        availableSlots: 20,
        bookedMembers: [],
        scans: [],
      };

      const mockQuery: any = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([scheduledClassDoc]),
      };
      (ScheduledClass.find as jest.Mock).mockReturnValue(mockQuery);
      (NonUserBooking.find as jest.Mock).mockResolvedValue([]);

      const result = await CoachService.getScans(hanaAbazaDocId, new Date("2026-10-27"), hanaAbazaUserId);

      expect(result).toHaveLength(1);
      expect(result[0].classTitle).toBe("Conditioning (Circuit)");
      expect(result[0].category).toBe("FUNCTIONAL_TRAINING");
      expect(result[0].coachNames).toBe("Omar Adel");

      // Verify ScheduledClass query included cid: { $in: [ftClassId] }
      expect(ScheduledClass.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ cid: { $in: [ftClassId] } }),
          ]),
        })
      );
    });

    it("includes all STUDIO classes when viewed by Hana Rashwan", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaRashwanDocId,
        coachName: "Hana Rashwan",
        phoneNumber: "01001061010",
        userId: hanaRashwanUserId,
      });
      mockUserFindById({
        _id: hanaRashwanUserId,
        name: "Hana Rashwan",
        role: "managing_coach",
      });

      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      const studioClassId = new Types.ObjectId();
      const studioClassDoc = {
        _id: studioClassId,
        title: "Reformer Pilates",
        category: "STUDIO",
      };

      (Class.find as jest.Mock).mockImplementation((query: any) => {
        if (query?.category) {
          return mockClassFindResult([studioClassDoc]);
        }
        if (query?._id?.$in) {
          return mockClassFindResult([studioClassDoc]);
        }
        return mockClassFindResult([]);
      });

      const scheduledClassDoc = {
        _id: new Types.ObjectId(),
        cid: studioClassId,
        locationId: new Types.ObjectId(),
        coachId: [{ _id: new Types.ObjectId(), coachName: "Salma" }],
        startTime: new Date("2026-10-27T10:00:00.000Z"),
        endTime: new Date("2026-10-27T11:00:00.000Z"),
        availableSlots: 10,
        bookedMembers: [],
        scans: [],
      };

      const mockQuery: any = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([scheduledClassDoc]),
      };
      (ScheduledClass.find as jest.Mock).mockReturnValue(mockQuery);
      (NonUserBooking.find as jest.Mock).mockResolvedValue([]);

      const result = await CoachService.getScans(hanaRashwanDocId, new Date("2026-10-27"), hanaRashwanUserId);

      expect(result).toHaveLength(1);
      expect(result[0].classTitle).toBe("Reformer Pilates");
      expect(result[0].category).toBe("STUDIO");
      expect(result[0].coachNames).toBe("Salma");
    });
  });

  describe("confirmAttendance authorization", () => {
    it("allows managing coach Hana Abaza to confirm attendance for FUNCTIONAL_TRAINING classes", async () => {
      const ftClassId = new Types.ObjectId();
      const scid = new Types.ObjectId().toString();

      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaAbazaDocId,
        coachName: "Hana Abaza",
        userId: hanaAbazaUserId,
      });
      mockUserFindById({
        _id: hanaAbazaUserId,
        name: "Hana Abaza",
        role: "managing_coach",
      });

      const otherCoachId = new Types.ObjectId();
      const scheduledClassDoc: any = {
        _id: new Types.ObjectId(scid),
        cid: ftClassId,
        coachId: [otherCoachId], // Hana Abaza is NOT directly assigned
        startTime: new Date(Date.now() - 3600000), // 1 hour ago
        endTime: new Date(Date.now() - 1800000),   // ended 30m ago (well past halfway)
        scans: [],
        attendanceConfirmation: {},
        save: jest.fn().mockResolvedValue(true),
      };

      (ScheduledClass.findById as jest.Mock).mockResolvedValue(scheduledClassDoc);
      (Class.findById as jest.Mock).mockResolvedValue({
        _id: ftClassId,
        title: "Strength (Full Body)",
        category: "FUNCTIONAL_TRAINING",
      });
      (NonUserBooking.countDocuments as jest.Mock).mockResolvedValue(0);

      const res = await CoachService.confirmAttendance(
        hanaAbazaDocId,
        scid,
        { confirmedCount: 12 },
        undefined,
        hanaAbazaUserId
      );

      expect(res.attendanceConfirmation.confirmed).toBe(true);
      expect(res.attendanceConfirmation.confirmedCount).toBe(12);
      expect(scheduledClassDoc.save).toHaveBeenCalled();
    });

    it("rejects non-assigned coach with ForbiddenError if class is not in their extra categories", async () => {
      const scid = new Types.ObjectId().toString();
      const studioClassId = new Types.ObjectId();

      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: otherCoachDocId,
        coachName: "Omar Adel",
        userId: otherCoachUserId,
      });
      mockUserFindById({
        _id: otherCoachUserId,
        name: "Omar Adel",
        role: "coach",
      });

      const scheduledClassDoc: any = {
        _id: new Types.ObjectId(scid),
        cid: studioClassId,
        coachId: [new Types.ObjectId()], // Not Omar Adel
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() - 1800000),
        scans: [],
      };

      (ScheduledClass.findById as jest.Mock).mockResolvedValue(scheduledClassDoc);
      (Class.findById as jest.Mock).mockResolvedValue({
        _id: studioClassId,
        title: "Reformer Pilates",
        category: "STUDIO",
      });

      await expect(
        CoachService.confirmAttendance(
          otherCoachDocId,
          scid,
          { confirmedCount: 5 },
          undefined,
          otherCoachUserId
        )
      ).rejects.toThrow("You are not assigned to this scheduled class");
    });
  });

  describe("getMe returns scansCategories and hasScheduledClasses", () => {
    it("returns scansCategories: ['STUDIO'] and hasScheduledClasses: true for Hana Rashwan even if personal classes are 0", async () => {
      (Coach.findById as jest.Mock).mockResolvedValue({
        _id: hanaRashwanDocId,
        coachName: "Hana Rashwan",
        userId: hanaRashwanUserId,
      });
      mockUserFindById({
        _id: hanaRashwanUserId,
        name: "Hana Rashwan",
        email: "hanarashwan@aucegypt.edu",
        phoneNumber: "01001061010",
        role: "managing_coach",
      });

      (Coach.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      (Package.countDocuments as jest.Mock).mockResolvedValue(0);
      (ScheduledClass.countDocuments as jest.Mock).mockResolvedValue(0); // 0 personal classes

      const me = await CoachService.getMe(hanaRashwanUserId, hanaRashwanDocId);

      expect(me.hasScheduledClasses).toBe(true);
      expect(me.scansCategories).toEqual(["STUDIO"]);
    });
  });
});
