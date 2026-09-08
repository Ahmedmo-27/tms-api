import { BookingsService } from "./bookings-service";
import { SchedulerService } from "./scheduler-service";
import { WaitlistService } from "./waitlist-service";
import { NotFoundError } from "../core/ApiError";
import ScheduledClass from "../models/scheduledClass";

jest.mock("../models/scheduledClass");
jest.mock("../models/member");
jest.mock("../models/user");
jest.mock("../models/payment");
jest.mock("../models/location");
jest.mock("../models/package");
jest.mock("../models/waitlistEntry");
jest.mock("../models/reservation");

describe("Proactive scid validation across services", () => {
  const invalidScids = [
    "opengym:69ec4abad8394559ce7ca77c",
    "pt:69ec4abad8394559ce7ca77c",
    "invalid-non-object-id",
    "",
  ];

  const mockUid = "69fbd32113c8a32010c5b809";
  const mockIo = { emit: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("BookingsService", () => {
    it.each(invalidScids)(
      "addBooking rejects invalid scid %s with CLASS_NOT_FOUND without calling ScheduledClass.findById",
      async (invalidScid) => {
        await expect(
          BookingsService.addBooking(mockUid, invalidScid),
        ).rejects.toThrow(NotFoundError);

        await expect(
          BookingsService.addBooking(mockUid, invalidScid),
        ).rejects.toMatchObject({
          code: "CLASS_NOT_FOUND",
        });

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "cancelBooking rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.cancelBooking(mockUid, invalidScid),
        ).rejects.toThrow(NotFoundError);

        await expect(
          BookingsService.cancelBooking(mockUid, invalidScid),
        ).rejects.toMatchObject({
          code: "CLASS_NOT_FOUND",
        });

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "cancelDropIn rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.cancelDropIn(mockUid, invalidScid),
        ).rejects.toThrow(NotFoundError);

        await expect(
          BookingsService.cancelDropIn(mockUid, invalidScid),
        ).rejects.toMatchObject({
          code: "CLASS_NOT_FOUND",
        });

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "recordAttendance rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.recordAttendance(mockUid, invalidScid, mockIo),
        ).rejects.toThrow(NotFoundError);

        await expect(
          BookingsService.recordAttendance(mockUid, invalidScid, mockIo),
        ).rejects.toMatchObject({
          code: "CLASS_NOT_FOUND",
        });

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "manualRecordClassAttendance rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.manualRecordClassAttendance(mockUid, invalidScid, mockIo),
        ).rejects.toThrow(NotFoundError);

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "bookDropIn rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.bookDropIn(mockUid, invalidScid, "ref-123"),
        ).rejects.toThrow(NotFoundError);

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "addMemberToWaitingList rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          BookingsService.addMemberToWaitingList(mockUid, "fcm-token", invalidScid),
        ).rejects.toThrow(NotFoundError);
      },
    );
  });

  describe("SchedulerService", () => {
    it.each(invalidScids)(
      "cancelClass rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          SchedulerService.cancelClass(invalidScid),
        ).rejects.toThrow(NotFoundError);

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "editClass rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          SchedulerService.editClass({ availableSlots: 10 }, invalidScid),
        ).rejects.toThrow(NotFoundError);

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );
  });

  describe("WaitlistService", () => {
    it.each(invalidScids)(
      "joinWaitlist rejects invalid scid %s with CLASS_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          WaitlistService.joinWaitlist(mockUid, invalidScid),
        ).rejects.toThrow(NotFoundError);

        expect(ScheduledClass.findById).not.toHaveBeenCalled();
      },
    );

    it.each(invalidScids)(
      "leaveWaitlist rejects invalid scid %s with WAITLIST_ENTRY_NOT_FOUND",
      async (invalidScid) => {
        await expect(
          WaitlistService.leaveWaitlist(mockUid, invalidScid),
        ).rejects.toThrow(NotFoundError);
      },
    );
  });
});
