import { Types } from "mongoose";
import {
  MissedSessionService,
  MISSED_SESSION_LOOKBACK_MS,
} from "./missed-session-service";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import { NotificationsService } from "./notifications-service";

jest.mock("../models/member");
jest.mock("../models/scheduledClass");
jest.mock("./notifications-service", () => ({
  NotificationsService: { notifyUsers: jest.fn() },
}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const MIN = 60 * 1000;

describe("MissedSessionService.notifyMissedSessions", () => {
  const now = new Date("2026-09-14T14:05:00.000Z"); // 17:05 Cairo
  const uid = new Types.ObjectId();
  const scid = new Types.ObjectId();

  const makeClass = (overrides: { price?: number; category?: string; scans?: any[] } = {}) => ({
    _id: scid,
    startTime: new Date(now.getTime() - 65 * MIN), // 16:00 Cairo
    endTime: new Date(now.getTime() - 5 * MIN),
    scans: overrides.scans ?? [],
    cid: {
      title: "Mat Pilates",
      category: overrides.category ?? "STUDIO",
      price: overrides.price ?? 450,
    },
  });

  const makeMember = (overrides: { isDropIn?: boolean; attended?: boolean } = {}) => ({
    uid,
    bookings: [{ scid, isDropIn: !!overrides.isDropIn }],
    attendance: overrides.attended ? [{ scid }] : [],
  });

  const mockClasses = (classes: any[]) =>
    (ScheduledClass.find as jest.Mock).mockReturnValue({
      populate: jest.fn().mockResolvedValue(classes),
    });
  const mockMembers = (members: any[]) =>
    (Member.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(members),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    (Member.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
    (NotificationsService.notifyUsers as jest.Mock).mockResolvedValue(undefined);
  });

  it("only queries classes that ended within the last 24 hours", async () => {
    mockClasses([]);

    await MissedSessionService.notifyMissedSessions(now);

    expect(ScheduledClass.find).toHaveBeenCalledWith({
      endTime: {
        $lte: now,
        $gte: new Date(now.getTime() - MISSED_SESSION_LOOKBACK_MS),
      },
    });
    expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
  });

  it("notifies a package booking with no attendance once and claims it", async () => {
    mockClasses([makeClass()]);
    mockMembers([makeMember()]);

    const summary = await MissedSessionService.notifyMissedSessions(now);

    expect(Member.updateOne).toHaveBeenCalledWith(
      {
        uid,
        bookings: { $elemMatch: { scid, missedNotifiedAt: { $exists: false } } },
      },
      { $set: { "bookings.$.missedNotifiedAt": now } },
    );
    expect(NotificationsService.notifyUsers).toHaveBeenCalledTimes(1);
    expect(NotificationsService.notifyUsers).toHaveBeenCalledWith(
      [String(uid)],
      "Missed Session",
      "You missed Mat Pilates at 4:00 PM. The session was counted from your package.",
      {
        type: "MISSED_SESSION",
        scid: String(scid),
        className: "Mat Pilates",
        startTime: new Date(now.getTime() - 65 * MIN).toISOString(),
      },
    );
    expect(summary).toMatchObject({ classesChecked: 1, notified: 1, failed: 0 });
  });

  it("does not notify a member who attended", async () => {
    mockClasses([makeClass()]);
    mockMembers([makeMember({ attended: true })]);

    const summary = await MissedSessionService.notifyMissedSessions(now);

    expect(Member.updateOne).not.toHaveBeenCalled();
    expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it("does not notify when a successful scan exists on the class", async () => {
    mockClasses([makeClass({ scans: [{ uid, status: true }] })]);
    mockMembers([makeMember()]);

    await MissedSessionService.notifyMissedSessions(now);

    expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
  });

  it("still notifies when the only scan on the class failed", async () => {
    mockClasses([makeClass({ scans: [{ uid, status: false }] })]);
    mockMembers([makeMember()]);

    await MissedSessionService.notifyMissedSessions(now);

    expect(NotificationsService.notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("does not notify drop-in bookings", async () => {
    mockClasses([makeClass()]);
    mockMembers([makeMember({ isDropIn: true })]);

    await MissedSessionService.notifyMissedSessions(now);

    expect(Member.updateOne).not.toHaveBeenCalled();
    expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
  });

  it.each([
    ["free class", { price: 0 }],
    ["workspace class", { category: "WORKSPACE" }],
  ])("does not notify for a %s", async (_label, overrides) => {
    mockClasses([makeClass(overrides)]);
    mockMembers([makeMember()]);

    await MissedSessionService.notifyMissedSessions(now);

    expect(Member.find).not.toHaveBeenCalled();
    expect(NotificationsService.notifyUsers).not.toHaveBeenCalled();
  });

  it("running the job twice sends only one notification", async () => {
    mockClasses([makeClass()]);
    mockMembers([makeMember()]);
    (Member.updateOne as jest.Mock)
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 });

    await MissedSessionService.notifyMissedSessions(now);
    const second = await MissedSessionService.notifyMissedSessions(now);

    expect(NotificationsService.notifyUsers).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ notified: 0, skipped: 1 });
  });

  it("keeps going when one member's notification fails", async () => {
    const otherUid = new Types.ObjectId();
    mockClasses([makeClass()]);
    mockMembers([makeMember(), { ...makeMember(), uid: otherUid }]);
    (NotificationsService.notifyUsers as jest.Mock)
      .mockRejectedValueOnce(new Error("FCM down"))
      .mockResolvedValueOnce(undefined);

    const summary = await MissedSessionService.notifyMissedSessions(now);

    expect(NotificationsService.notifyUsers).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ notified: 1, failed: 1 });
  });

  it("never throws when loading classes fails", async () => {
    (ScheduledClass.find as jest.Mock).mockReturnValue({
      populate: jest.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(MissedSessionService.notifyMissedSessions(now)).resolves.toMatchObject({
      classesChecked: 0,
    });
  });
});
