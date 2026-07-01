import { BadRequestError } from "../core/ApiError";
import { normalizeOpenGymPackageFields } from "./open-gym-package";

describe("normalizeOpenGymPackageFields", () => {
  it("defaults gym-only packages to unlimited session pool", () => {
    expect(
      normalizeOpenGymPackageFields({
        category: "OPEN_GYM",
        expiryPeriod: 30,
        opensClasses: [],
      }),
    ).toEqual({ expiryPeriod: 30, numberOfSessions: 10000 });
  });

  it("requires numberOfSessions when opensClasses are set", () => {
    expect(() =>
      normalizeOpenGymPackageFields({
        category: "OPEN_GYM",
        expiryPeriod: 30,
        opensClasses: ["class-id"],
      }),
    ).toThrow(BadRequestError);
  });

  it("keeps explicit session count for combo packages", () => {
    expect(
      normalizeOpenGymPackageFields({
        category: "OPEN_GYM",
        expiryPeriod: 60,
        numberOfSessions: 8,
        opensClasses: ["studio-id", "ft-id"],
      }),
    ).toEqual({ expiryPeriod: 60, numberOfSessions: 8 });
  });
});
