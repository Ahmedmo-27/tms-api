import { Types } from "mongoose";
import {
  planMemberSoldByBackfill,
  applySoldByBackfillToPackages,
  isDeletedPackageStatus,
} from "./member-sold-by-backfill";

const sellerA = new Types.ObjectId().toString();
const sellerB = new Types.ObjectId().toString();
const actor = new Types.ObjectId().toString();
const migrationRunAt = new Date("2026-11-28T12:00:00.000Z");

const pkg = (
  id: string,
  overrides: Partial<{
    status: string;
    soldBy: string | null;
    soldByAssignedAt: Date | null;
    soldByAssignedBy: string | null;
    pkgStartDate: Date | null;
  }> = {},
) => ({
  _id: id,
  status: "ACTIVE",
  soldBy: null,
  soldByAssignedAt: null,
  soldByAssignedBy: null,
  pkgStartDate: new Date("2026-01-01"),
  ...overrides,
});

describe("member-sold-by-backfill", () => {
  it("treats DELETED status case-insensitively", () => {
    expect(isDeletedPackageStatus("Deleted")).toBe(true);
    expect(isDeletedPackageStatus("ACTIVE")).toBe(false);
  });

  it("promotes a single package-level seller to member and fills unassigned packages", () => {
    const p1 = "p1";
    const p2 = "p2";
    const assignedAt = new Date("2026-06-01");
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m1",
        packages: [
          pkg(p1, {
            soldBy: sellerA,
            soldByAssignedAt: assignedAt,
            soldByAssignedBy: actor,
          }),
          pkg(p2),
        ],
      },
      migrationRunAt,
    );

    expect(plan).not.toBeNull();
    expect(plan?.attribution.soldBy).toBe(sellerA);
    expect(plan?.memberFieldsChanged).toBe(true);
    expect(plan?.packageIdsToUpdate).toEqual([p2]);

    const updated = applySoldByBackfillToPackages(
      [
        pkg(p1, {
          soldBy: sellerA,
          soldByAssignedAt: assignedAt,
          soldByAssignedBy: actor,
        }),
        pkg(p2),
      ],
      plan!,
      { migrationRunAt },
    );
    expect(updated[1].soldBy).toBe(sellerA);
    expect(updated[1].soldByAssignedAt).toEqual(assignedAt);
    expect(updated[1].soldByAssignedBy).toBe(actor);
  });

  it("resolves conflicting sellers by latest soldByAssignedAt", () => {
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m2",
        packages: [
          pkg("a", {
            soldBy: sellerA,
            soldByAssignedAt: new Date("2026-01-01"),
          }),
          pkg("b", {
            soldBy: sellerB,
            soldByAssignedAt: new Date("2026-07-01"),
          }),
        ],
      },
      migrationRunAt,
    );

    expect(plan?.attribution.soldBy).toBe(sellerB);
    expect(plan?.conflict?.tieBreak).toBe("soldByAssignedAt");
    expect(plan?.conflict?.sellerIds).toEqual([sellerA, sellerB].sort());
  });

  it("falls back to pkgStartDate when soldByAssignedAt is missing", () => {
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m3",
        packages: [
          pkg("a", {
            soldBy: sellerA,
            pkgStartDate: new Date("2026-08-01"),
          }),
          pkg("b", {
            soldBy: sellerB,
            pkgStartDate: new Date("2026-02-01"),
          }),
        ],
      },
      migrationRunAt,
    );

    expect(plan?.attribution.soldBy).toBe(sellerA);
    expect(plan?.conflict?.tieBreak).toBe("pkgStartDate");
  });

  it("syncs packages to existing member.soldBy without changing the member", () => {
    const assignedAt = new Date("2026-05-01");
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m4",
        soldBy: sellerA,
        soldByAssignedAt: assignedAt,
        soldByAssignedBy: actor,
        packages: [
          pkg("synced", { soldBy: sellerA, soldByAssignedAt: assignedAt }),
          pkg("gap"),
        ],
      },
      migrationRunAt,
    );

    expect(plan?.memberFieldsChanged).toBe(false);
    expect(plan?.packageIdsToUpdate).toEqual(["gap"]);
    expect(plan?.attribution.soldBy).toBe(sellerA);
  });

  it("is a no-op when member and active packages already match", () => {
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m5",
        soldBy: sellerA,
        soldByAssignedAt: new Date("2026-05-01"),
        packages: [pkg("only", { soldBy: sellerA })],
      },
      migrationRunAt,
    );
    expect(plan).toBeNull();
  });

  it("does not touch deleted packages even when they carry another seller", () => {
    const plan = planMemberSoldByBackfill(
      {
        memberId: "m6",
        packages: [
          pkg("live", { soldBy: sellerA }),
          pkg("dead", { status: "DELETED", soldBy: sellerB }),
        ],
      },
      migrationRunAt,
    );

    expect(plan?.packageIdsToUpdate).not.toContain("dead");
    const updated = applySoldByBackfillToPackages(
      [
        pkg("live", { soldBy: sellerA }),
        pkg("dead", { status: "DELETED", soldBy: sellerB }),
      ],
      plan!,
      { migrationRunAt },
    );
    expect(updated[1].soldBy).toBe(sellerB);
  });
});