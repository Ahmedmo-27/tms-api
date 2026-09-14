import { Types } from "mongoose";
import { NotificationsService } from "./notifications-service";
import User from "../models/user";

jest.mock("../models/user");
jest.mock("../config/firebase", () => ({}));
jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("NotificationsService.notifyUsers", () => {
  const userA = new Types.ObjectId().toString();
  const userB = new Types.ObjectId().toString();

  const mockUsers = (users: any[]) =>
    (User.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(users),
    });

  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sendSpy = jest
      .spyOn(NotificationsService, "sendNotification")
      .mockResolvedValue(undefined);
  });

  afterEach(() => sendSpy.mockRestore());

  it("sends to the users' FCM tokens, not their user ids (deduped, empties removed)", async () => {
    mockUsers([
      { fcmTokens: ["token-1", "token-2"] },
      { fcmTokens: ["token-2", "", "token-3"] },
    ]);

    await NotificationsService.notifyUsers([userA, userB], "Title", "Body", {
      type: "X",
    });

    expect(User.find).toHaveBeenCalledWith({ _id: { $in: [userA, userB] } });
    expect(sendSpy).toHaveBeenCalledWith(
      ["token-1", "token-2", "token-3"],
      "Title",
      "Body",
      { type: "X" },
    );
    const sentTokens = sendSpy.mock.calls[0][0] as string[];
    expect(sentTokens).not.toContain(userA);
    expect(sentTokens).not.toContain(userB);
  });

  it("does nothing and does not throw when the user has no tokens", async () => {
    mockUsers([{ fcmTokens: [] }]);

    await expect(
      NotificationsService.notifyUsers([userA], "Title", "Body"),
    ).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("ignores invalid ids without querying", async () => {
    await NotificationsService.notifyUsers(["not-an-id"], "Title", "Body");

    expect(User.find).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
