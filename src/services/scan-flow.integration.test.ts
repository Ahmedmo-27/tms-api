import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import { Server } from "http";
import { BookingsService } from "./bookings-service";
import { parseScanPayload } from "../utils/scan-payload";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import Class from "../models/class";
import Coach from "../models/coach";
import Location from "../models/location";
import ScheduledClass from "../models/scheduledClass";
import DailyAttendance from "../models/dailyAttendance";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../core/ApiError";

describe("scan flow integration", () => {
  let mongo: MongoMemoryServer;
  const io = { emit: jest.fn() } as unknown as Server;

  let branchA: Types.ObjectId;
  let branchB: Types.ObjectId;
  let fitnessClass: Types.ObjectId;
  let workspaceClass: Types.ObjectId;
  let fitnessPkg: Types.ObjectId;
  let openGymPkgBranchA: Types.ObjectId;
  let openGymPkgBranchB: Types.ObjectId;
  let ptPkg: Types.ObjectId;
  let coach: Types.ObjectId;
  let memberUser: Types.ObjectId;
  let memberUid: string;

  const futureStart = () => new Date(Date.now() + 15 * 60 * 1000);
  const pastStart = () => new Date(Date.now() - 45 * 60 * 1000);

  async function createMemberWithPackages(
    packages: Array<{
      pkgId: Types.ObjectId;
      locationId?: Types.ObjectId;
      remainingClasses?: number;
    }>,
  ) {
    const user = await User.create({
      email: `member-${new Types.ObjectId()}@test.com`,
      password: "Password1",
      name: "Scan Test Member",
      phoneNumber: `01${Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, "0")}`,
      role: "member",
    });
    memberUser = user._id as Types.ObjectId;
    memberUid = memberUser.toString();

    await Member.create({
      uid: memberUser,
      packages: packages.map((p) => ({
        pkgId: p.pkgId,
        name: "Test Package",
        pkgStartDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        pkgEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "ACTIVE",
        remainingClasses: p.remainingClasses ?? 10,
        ...(p.locationId ? { locationId: p.locationId } : {}),
      })),
      bookings: [],
      attendance: [],
      ptAttendance: [],
      isActive: true,
    });

    return { user, memberUid };
  }

  async function createScheduledSession(options: {
    classId: Types.ObjectId;
    locationId?: Types.ObjectId;
    startTime?: Date;
    bookMemberId?: string;
  }) {
    const start = options.startTime ?? futureStart();
    const sc = await ScheduledClass.create({
      cid: options.classId,
      locationId: options.locationId,
      coachId: [coach],
      startTime: start,
      endTime: new Date(start.getTime() + 60 * 60 * 1000),
      availableSlots: 10,
      bookedMembers: options.bookMemberId
        ? [{ uid: new Types.ObjectId(options.bookMemberId), method: "Test Pkg" }]
        : [],
      scans: [],
      waitingList: [],
      waitlistedMembers: [],
    });

    if (options.bookMemberId) {
      await Member.updateOne(
        { uid: options.bookMemberId },
        {
          $push: {
            bookings: {
              scid: sc._id,
              bookingTime: new Date(),
              isDropIn: false,
            },
          },
        },
      );
    }

    return sc as { _id: Types.ObjectId };
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([
      User.deleteMany({}),
      Member.deleteMany({}),
      Package.deleteMany({}),
      Class.deleteMany({}),
      Coach.deleteMany({}),
      Location.deleteMany({}),
      ScheduledClass.deleteMany({}),
      DailyAttendance.deleteMany({}),
    ]);

    branchA = (
      await Location.create({
        branchName: "Branch A",
        location: "Cairo A",
        locationUrl: "https://example.com/a",
      })
    )._id as Types.ObjectId;

    branchB = (
      await Location.create({
        branchName: "Branch B",
        location: "Cairo B",
        locationUrl: "https://example.com/b",
      })
    )._id as Types.ObjectId;

    coach = (
      await Coach.create({
        coachName: "Test Coach",
        phoneNumber: "01000000001",
        bio: "Test",
      })
    )._id as Types.ObjectId;

    const fitness = await Class.create({
      title: "Pilates",
      category: "STUDIO",
      price: 0,
      locations: [branchA],
      points: 1,
      allowDropIn: true,
    });
    fitnessClass = fitness._id as Types.ObjectId;

    const workspace = await Class.create({
      title: "Workspace",
      category: "WORKSPACE",
      price: 0,
      locations: [branchA, branchB],
      allowDropIn: true,
    });
    workspaceClass = workspace._id as Types.ObjectId;

    fitnessPkg = (
      await Package.create({
        name: "Pilates Pack Branch A",
        category: "STUDIO",
        price: 1000,
        expiryPeriod: 30,
        opensClasses: [fitnessClass],
        locationId: branchA,
      })
    )._id as Types.ObjectId;

    openGymPkgBranchA = (
      await Package.create({
        name: "Open Gym Branch A",
        category: "OPEN_GYM",
        price: 500,
        expiryPeriod: 30,
        opensClasses: [],
        locationId: branchA,
      })
    )._id as Types.ObjectId;

    openGymPkgBranchB = (
      await Package.create({
        name: "Open Gym Branch B",
        category: "OPEN_GYM",
        price: 500,
        expiryPeriod: 30,
        opensClasses: [],
        locationId: branchB,
      })
    )._id as Types.ObjectId;

    ptPkg = (
      await Package.create({
        name: "PT Package",
        category: "PERSONAL_TRAINING",
        price: 2000,
        expiryPeriod: 30,
        opensClasses: [],
      })
    )._id as Types.ObjectId;
  });

  describe("payload routing", () => {
    it("routes branch open gym before treating payload as a class id", () => {
      const locationId = branchA.toString();
      expect(parseScanPayload(`opengym:${locationId}`)).toEqual({
        type: "branch_open_gym",
        locationId,
      });
    });

    it("routes scheduled class ids separately from open gym", () => {
      const scid = new Types.ObjectId().toString();
      expect(parseScanPayload(scid)).toEqual({
        type: "scheduled_class",
        scheduledClassId: scid,
      });
    });
  });

  describe("scheduled class session scans", () => {
    it("succeeds when member is booked with an active package", async () => {
      await createMemberWithPackages([{ pkgId: fitnessPkg }]);
      const session = await createScheduledSession({
        classId: fitnessClass,
        locationId: branchA,
        bookMemberId: memberUid,
      });

      await BookingsService.recordAttendance(
        memberUid,
        session._id.toString(),
        io,
      );

      const member = await Member.findOne({ uid: memberUid });
      expect(
        member?.attendance.some(
          (a) => a.scid.toString() === session._id.toString(),
        ),
      ).toBe(true);
      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({ code: "CLASS_ATTENDED" }),
      );
    });

    it("fails with CLASS_NOT_BOOKED when member has a package but is not booked", async () => {
      await createMemberWithPackages([{ pkgId: fitnessPkg }]);
      const session = await createScheduledSession({
        classId: fitnessClass,
        locationId: branchA,
      });

      await expect(
        BookingsService.recordAttendance(
          memberUid,
          session._id.toString(),
          io,
        ),
      ).rejects.toMatchObject({
        code: "CLASS_NOT_BOOKED",
      });
    });

    it("fails when check-in is more than 30 minutes after class start", async () => {
      await createMemberWithPackages([{ pkgId: fitnessPkg }]);
      const session = await createScheduledSession({
        classId: fitnessClass,
        locationId: branchA,
        startTime: pastStart(),
        bookMemberId: memberUid,
      });

      await expect(
        BookingsService.recordAttendance(
          memberUid,
          session._id.toString(),
          io,
        ),
      ).rejects.toMatchObject({
        code: "PAST_ATTENDANCE_DEADLINE",
      });
    });

    it("fails on duplicate successful check-in", async () => {
      await createMemberWithPackages([{ pkgId: fitnessPkg }]);
      const session = await createScheduledSession({
        classId: fitnessClass,
        locationId: branchA,
        bookMemberId: memberUid,
      });

      await BookingsService.recordAttendance(
        memberUid,
        session._id.toString(),
        io,
      );

      await expect(
        BookingsService.recordAttendance(
          memberUid,
          session._id.toString(),
          io,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("branch open gym scans", () => {
    it("succeeds at the member package branch", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);

      await BookingsService.recordOpenGymAttendance(
        memberUid,
        io,
        branchA.toString(),
      );

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({
          code: "OPEN_GYM_CLASS_ATTENDED",
          locationId: branchA.toString(),
        }),
      );
    });

    it("fails when member scans a different branch QR", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);

      await expect(
        BookingsService.recordOpenGymAttendance(
          memberUid,
          io,
          branchB.toString(),
        ),
      ).rejects.toMatchObject({
        code: "NO_ACCESS_AT_LOCATION",
      });
    });

    it("succeeds at branch B when member holds a branch B package", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchB, locationId: branchB },
      ]);

      await BookingsService.recordOpenGymAttendance(
        memberUid,
        io,
        branchB.toString(),
      );

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({
          code: "OPEN_GYM_CLASS_ATTENDED",
          locationId: branchB.toString(),
        }),
      );
    });

    it("rejects unknown branch ids", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);
      const missingBranch = new Types.ObjectId().toString();

      await expect(
        BookingsService.recordOpenGymAttendance(memberUid, io, missingBranch),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("rejects duplicate open gym check-in on the same day at the same branch", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);

      await BookingsService.recordOpenGymAttendance(
        memberUid,
        io,
        branchA.toString(),
      );

      await expect(
        BookingsService.recordOpenGymAttendance(
          memberUid,
          io,
          branchA.toString(),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("legacy open gym scans", () => {
    it("uses the only branch when a single location exists", async () => {
      await Location.deleteMany({ _id: branchB });
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);

      await BookingsService.recordLegacyOpenGymAttendance(memberUid, io);

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({
          code: "OPEN_GYM_CLASS_ATTENDED",
          locationId: branchA.toString(),
          legacyOpenGymPayload: "opengym",
        }),
      );
    });

    it("rejects legacy open gym when multiple branches exist without a default", async () => {
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);
      delete process.env.LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID;

      await expect(
        BookingsService.recordLegacyOpenGymAttendance(memberUid, io),
      ).rejects.toMatchObject({
        code: "LEGACY_OPEN_GYM_UNAVAILABLE",
      });
    });

    it("uses LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID when configured", async () => {
      process.env.LEGACY_OPEN_GYM_DEFAULT_LOCATION_ID = branchA.toString();
      await createMemberWithPackages([
        { pkgId: openGymPkgBranchA, locationId: branchA },
      ]);

      await BookingsService.recordLegacyOpenGymAttendance(memberUid, io);

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({
          code: "OPEN_GYM_CLASS_ATTENDED",
          locationId: branchA.toString(),
        }),
      );
    });
  });

  describe("PT scans", () => {
    it("succeeds with an active PT package", async () => {
      await createMemberWithPackages([{ pkgId: ptPkg }]);

      await BookingsService.recordPtAttendance(memberUid, io);

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({ code: "PT_CLASS_ATTENDED" }),
      );
    });

    it("fails when member has no PT package", async () => {
      await createMemberWithPackages([{ pkgId: fitnessPkg }]);

      await expect(
        BookingsService.recordPtAttendance(memberUid, io),
      ).rejects.toMatchObject({
        code: "NO_ACTIVE_PACKAGE_FOUND",
      });
    });
  });

  describe("workspace session context", () => {
    it("allows open gym scan via branch QR for workspace-eligible package", async () => {
      const spacePkg = await Package.create({
        name: "Space Membership A",
        category: "SPACE_MEMBERSHIP",
        price: 1500,
        expiryPeriod: 30,
        opensClasses: [workspaceClass],
        locationId: branchA,
      });

      await createMemberWithPackages([
        { pkgId: spacePkg._id as Types.ObjectId, locationId: branchA },
      ]);

      await BookingsService.recordOpenGymAttendance(
        memberUid,
        io,
        branchA.toString(),
      );

      expect(io.emit).toHaveBeenCalledWith(
        "SUCCESS-SCAN",
        expect.objectContaining({ code: "OPEN_GYM_CLASS_ATTENDED" }),
      );
    });
  });
});
