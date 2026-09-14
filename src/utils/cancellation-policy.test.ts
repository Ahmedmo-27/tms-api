import {
  getCancellationDeadline,
  resolveCancellation,
} from "./cancellation-policy";

// Class starts at 16:00
const startTime = new Date("2026-09-14T16:00:00.000Z");
const at = (iso: string) => new Date(`2026-09-14T${iso}.000Z`);

const packageBooking = { usesPackageSession: true, isDropIn: false };
const freeBooking = { usesPackageSession: false, isDropIn: false };
const dropInBooking = { usesPackageSession: false, isDropIn: true };

describe("getCancellationDeadline", () => {
  it("is 3 hours before start", () => {
    expect(getCancellationDeadline(startTime).toISOString()).toBe(
      "2026-09-14T13:00:00.000Z",
    );
  });
});

describe("resolveCancellation — member, package booking", () => {
  const run = (now: Date) =>
    resolveCancellation({ startTime, now, cancelledBy: "member", ...packageBooking });

  it("returns the session when cancelled before 1 PM", () => {
    expect(run(at("12:59:00"))).toEqual({
      allowed: true,
      returnSession: true,
      lateCancellation: false,
    });
  });

  it("returns the session at exactly 1 PM (deadline inclusive)", () => {
    expect(run(at("13:00:00"))).toMatchObject({ returnSession: true });
  });

  it.each(["13:00:01", "13:01:00", "15:00:00", "15:59:00"])(
    "keeps the session deducted when cancelled at %s",
    (time) => {
      expect(run(at(time))).toEqual({
        allowed: true,
        returnSession: false,
        lateCancellation: true,
      });
    },
  );

  it.each(["16:00:00", "16:01:00"])("rejects cancelling at %s (started)", (time) => {
    expect(run(at(time))).toMatchObject({
      allowed: false,
      code: "CLASS_ALREADY_STARTED",
    });
  });
});

describe("resolveCancellation — staff", () => {
  it("always returns the session within 3 hours", () => {
    expect(
      resolveCancellation({
        startTime,
        now: at("15:00:00"),
        cancelledBy: "staff",
        ...packageBooking,
      }),
    ).toEqual({ allowed: true, returnSession: true, lateCancellation: false });
  });

  it("cannot cancel after the class started", () => {
    expect(
      resolveCancellation({
        startTime,
        now: at("16:30:00"),
        cancelledBy: "staff",
        ...packageBooking,
      }),
    ).toMatchObject({ allowed: false, code: "CLASS_ALREADY_STARTED" });
  });
});

describe("resolveCancellation — drop-ins and free classes", () => {
  it("still blocks drop-ins within 3 hours", () => {
    expect(
      resolveCancellation({
        startTime,
        now: at("14:00:00"),
        cancelledBy: "member",
        ...dropInBooking,
      }),
    ).toMatchObject({ allowed: false, code: "DEADLINE_PASSED" });
  });

  it("allows drop-ins before 3 hours without touching packages", () => {
    expect(
      resolveCancellation({
        startTime,
        now: at("12:00:00"),
        cancelledBy: "member",
        ...dropInBooking,
      }),
    ).toEqual({ allowed: true, returnSession: false, lateCancellation: false });
  });

  it("free/workspace classes can be cancelled within 3 hours, no package change", () => {
    expect(
      resolveCancellation({
        startTime,
        now: at("14:00:00"),
        cancelledBy: "member",
        ...freeBooking,
      }),
    ).toEqual({ allowed: true, returnSession: false, lateCancellation: false });
  });
});
