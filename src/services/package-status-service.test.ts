import {
  resolvePackageStatus,
  PackageStatusService,
} from "./package-status-service";

describe("PackageStatusService - resolvePackageStatus", () => {
  const referenceTime = new Date("2026-09-08T12:00:00Z");

  it("should return DELETED if status is DELETED", () => {
    const status = resolvePackageStatus(
      {
        status: "DELETED",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 10,
      },
      referenceTime
    );
    expect(status).toBe("DELETED");
  });

  it("should return FROZEN if package is currently frozen and freezeEndDate is in the future", () => {
    const status = resolvePackageStatus(
      {
        status: "FROZEN",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 10,
        freezeInfo: {
          isFrozen: true,
          freezeEndDate: new Date("2026-09-15T00:00:00Z"),
        },
      },
      referenceTime
    );
    expect(status).toBe("FROZEN");
  });

  it("should unfreeze and return ACTIVE if freezeEndDate has passed and package is still valid", () => {
    const status = resolvePackageStatus(
      {
        status: "FROZEN",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 5,
        freezeInfo: {
          isFrozen: true,
          freezeEndDate: new Date("2026-09-01T00:00:00Z"),
        },
      },
      referenceTime
    );
    expect(status).toBe("ACTIVE");
  });

  it("should return EXPIRED if pkgEndDate has passed", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        pkgEndDate: new Date("2026-06-04T00:00:00Z"),
        remainingClasses: 4,
      },
      referenceTime
    );
    expect(status).toBe("EXPIRED");
  });

  it("should return COMPLETED if remainingClasses is 0 and not expired", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 0,
      },
      referenceTime
    );
    expect(status).toBe("COMPLETED");
  });

  it("should prioritize EXPIRED over COMPLETED if end date is in the past and classes are 0", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        pkgEndDate: new Date("2026-06-04T00:00:00Z"),
        remainingClasses: 0,
      },
      referenceTime
    );
    expect(status).toBe("EXPIRED");
  });

  it("should return ACTIVE if package is not expired and has remaining classes", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 8,
      },
      referenceTime
    );
    expect(status).toBe("ACTIVE");
  });
});

describe("PackageStatusService - syncMemberPackageStatuses", () => {
  const referenceTime = new Date("2026-09-08T12:00:00Z");

  it("should mutate package status to EXPIRED when end date is past", () => {
    const member: any = {
      uid: "user-123",
      packages: [
        {
          pkgId: "pkg-1",
          name: "10 Functional Training",
          pkgStartDate: new Date("2026-04-20T00:00:00Z"),
          pkgEndDate: new Date("2026-06-04T00:00:00Z"),
          remainingClasses: 4,
          status: "ACTIVE",
        },
      ],
    };

    const modified = PackageStatusService.syncMemberPackageStatuses(
      member,
      referenceTime
    );
    expect(modified).toBe(true);
    expect(member.packages[0].status).toBe("EXPIRED");
  });

  it("should mutate package status to COMPLETED when remaining classes are 0", () => {
    const member: any = {
      uid: "user-123",
      packages: [
        {
          pkgId: "pkg-2",
          name: "20 Studio",
          pkgStartDate: new Date("2026-08-01T00:00:00Z"),
          pkgEndDate: new Date("2026-10-01T00:00:00Z"),
          remainingClasses: 0,
          status: "ACTIVE",
        },
      ],
    };

    const modified = PackageStatusService.syncMemberPackageStatuses(
      member,
      referenceTime
    );
    expect(modified).toBe(true);
    expect(member.packages[0].status).toBe("COMPLETED");
  });

  it("should return false if statuses are already correct", () => {
    const member: any = {
      uid: "user-123",
      packages: [
        {
          pkgId: "pkg-1",
          name: "10 Functional Training",
          pkgStartDate: new Date("2026-04-20T00:00:00Z"),
          pkgEndDate: new Date("2026-06-04T00:00:00Z"),
          remainingClasses: 4,
          status: "EXPIRED",
        },
      ],
    };

    const modified = PackageStatusService.syncMemberPackageStatuses(
      member,
      referenceTime
    );
    expect(modified).toBe(false);
  });
});
