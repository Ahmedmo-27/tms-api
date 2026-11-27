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

  it("should return COMPLETED if remainingClasses is 0 and not expired for standard class package", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 0,
        category: "STUDIO",
      },
      referenceTime
    );
    expect(status).toBe("COMPLETED");
  });

  it("should return ACTIVE if remainingClasses is 0 but package is MIXED / Spacer Mix and not expired", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        name: "Spacer Mix (Functional Training + Space)",
        pkgEndDate: new Date("2026-10-01T00:00:00Z"),
        remainingClasses: 0,
        category: "MIXED",
      },
      referenceTime
    );
    expect(status).toBe("ACTIVE");
  });

  it("should return EXPIRED for MIXED / Spacer Mix if pkgEndDate has passed even if classes were 0", () => {
    const status = resolvePackageStatus(
      {
        status: "ACTIVE",
        name: "Spacer Mix (Functional Training + Space)",
        pkgEndDate: new Date("2026-06-04T00:00:00Z"),
        remainingClasses: 0,
        category: "MIXED",
      },
      referenceTime
    );
    expect(status).toBe("EXPIRED");
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

  it("should mutate package status to COMPLETED when remaining classes are 0 for standard class package", () => {
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

  it("should preserve ACTIVE status for Spacer Mix package when remaining classes are 0 and pkgEndDate is future", () => {
    const member: any = {
      uid: "user-123",
      packages: [
        {
          pkgId: "pkg-3",
          name: "Spacer Mix (Functional Training + Space)",
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
    expect(modified).toBe(false);
    expect(member.packages[0].status).toBe("ACTIVE");
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

describe("PackageStatusService - filterClientPackages", () => {
  const referenceTime = new Date("2026-11-19T12:00:00Z");
  const validPkgId = { _id: "pkg-123", name: "Studio 10" };

  it("should return empty array if input is not array", () => {
    expect(PackageStatusService.filterClientPackages(null as any)).toEqual([]);
  });

  it("should filter out DELETED packages", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "DELETED",
        pkgEndDate: new Date("2026-12-01T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(0);
  });

  it("should filter out unpopulated or missing pkgId packages", () => {
    const pkgs = [
      {
        pkgId: null,
        status: "ACTIVE",
        pkgEndDate: new Date("2026-12-01T00:00:00Z"),
      },
      {
        pkgId: "not-an-object",
        status: "ACTIVE",
        pkgEndDate: new Date("2026-12-01T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(0);
  });

  it("should always retain ACTIVE and FROZEN packages", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "ACTIVE",
        pkgEndDate: new Date("2026-12-01T00:00:00Z"),
      },
      {
        pkgId: validPkgId,
        status: "FROZEN",
        pkgEndDate: new Date("2026-12-15T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(2);
  });

  it("should retain EXPIRED packages if expired within 30 days", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "EXPIRED",
        // Expired 10 days ago
        pkgEndDate: new Date("2026-11-09T12:00:00Z"),
      },
      {
        pkgId: validPkgId,
        status: "EXPIRED",
        // Expired 29 days ago
        pkgEndDate: new Date("2026-10-21T12:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(2);
  });

  it("should exclude EXPIRED packages if expired more than 30 days ago", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "EXPIRED",
        // Expired 31 days ago
        pkgEndDate: new Date("2026-10-19T11:00:00Z"),
      },
      {
        pkgId: validPkgId,
        status: "EXPIRED",
        // Expired 60 days ago
        pkgEndDate: new Date("2026-09-20T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(0);
  });

  it("should retain COMPLETED packages within 30 days of end date and exclude older ones", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "COMPLETED",
        // End date in future
        pkgEndDate: new Date("2026-11-25T00:00:00Z"),
      },
      {
        pkgId: validPkgId,
        status: "COMPLETED",
        // End date 15 days ago
        pkgEndDate: new Date("2026-11-04T00:00:00Z"),
      },
      {
        pkgId: validPkgId,
        status: "COMPLETED",
        // End date 45 days ago
        pkgEndDate: new Date("2026-10-05T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime);
    expect(filtered).toHaveLength(2);
  });

  it("should retain all packages if maxExpiredDays is Infinity (includeAll override)", () => {
    const pkgs = [
      {
        pkgId: validPkgId,
        status: "EXPIRED",
        pkgEndDate: new Date("2024-01-01T00:00:00Z"),
      },
    ];
    const filtered = PackageStatusService.filterClientPackages(pkgs, referenceTime, Infinity);
    expect(filtered).toHaveLength(1);
  });
});

describe("PackageStatusService - sortPackagesForClient", () => {
  it("should sort ACTIVE and FROZEN packages before EXPIRED and COMPLETED, newest start date first", () => {
    const pkgs = [
      {
        _id: "1",
        status: "EXPIRED",
        pkgStartDate: new Date("2026-09-01T00:00:00Z"),
      },
      {
        _id: "2",
        status: "ACTIVE",
        pkgStartDate: new Date("2026-11-01T00:00:00Z"),
      },
      {
        _id: "3",
        status: "EXPIRED",
        pkgStartDate: new Date("2026-10-15T00:00:00Z"),
      },
      {
        _id: "4",
        status: "ACTIVE",
        pkgStartDate: new Date("2026-11-10T00:00:00Z"),
      },
      {
        _id: "5",
        status: "FROZEN",
        pkgStartDate: new Date("2026-11-05T00:00:00Z"),
      },
    ];

    const sorted = PackageStatusService.sortPackagesForClient(pkgs);
    const ids = sorted.map((p) => p._id);
    expect(ids).toEqual(["4", "5", "2", "3", "1"]);
  });
});
