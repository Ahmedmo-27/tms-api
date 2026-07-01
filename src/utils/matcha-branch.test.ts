import { Types } from "mongoose";
import {
  assertMatchaPackageForPendingUser,
  assertMatchaSessionForPendingUser,
  clearMatchaLocationCache,
  getMatchaBranchName,
  isMatchaLocationId,
} from "./matcha-branch";
import { ForbiddenError } from "../core/ApiError";

describe("matcha-branch", () => {
  const matchaId = new Types.ObjectId().toString();

  beforeEach(() => {
    clearMatchaLocationCache();
    process.env.MATCHA_LOCATION_ID = matchaId;
  });

  afterEach(() => {
    delete process.env.MATCHA_LOCATION_ID;
    delete process.env.MATCHA_BRANCH_NAME;
    clearMatchaLocationCache();
  });

  it("defaults branch name to Matcha", () => {
    expect(getMatchaBranchName()).toBe("Matcha");
  });

  it("uses MATCHA_BRANCH_NAME when set", () => {
    process.env.MATCHA_BRANCH_NAME = "Matcha Studio";
    expect(getMatchaBranchName()).toBe("Matcha Studio");
  });

  it("resolves matcha location from env", async () => {
    expect(await isMatchaLocationId(matchaId)).toBe(true);
    expect(await isMatchaLocationId(new Types.ObjectId().toString())).toBe(
      false,
    );
  });

  it("rejects non-matcha packages for pending users", async () => {
    await expect(
      assertMatchaPackageForPendingUser({
        locationId: new Types.ObjectId(),
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows matcha packages for pending users", async () => {
    await expect(
      assertMatchaPackageForPendingUser({
        locationId: new Types.ObjectId(matchaId),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects non-matcha sessions for pending users", async () => {
    await expect(
      assertMatchaSessionForPendingUser({
        locationId: new Types.ObjectId(),
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows matcha sessions for pending users", async () => {
    await expect(
      assertMatchaSessionForPendingUser({
        locationId: new Types.ObjectId(matchaId),
      }),
    ).resolves.toBeUndefined();
  });
});
