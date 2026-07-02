import type { PackageDeletionImpact } from "./package-deletion-guard";

function buildWarningMessage(
  impact: Omit<PackageDeletionImpact, "warningMessage">,
): string {
  if (impact.totalSubscriptions === 0 && impact.paymentCount === 0) {
    return "No member subscriptions or payments reference this package.";
  }

  const parts: string[] = [];
  if (impact.activeSubscriptions > 0) {
    parts.push(`${impact.activeSubscriptions} active member subscription(s)`);
  }
  if (impact.deletedOrCompletedSubscriptions > 0) {
    parts.push(
      `${impact.deletedOrCompletedSubscriptions} inactive member subscription(s)`,
    );
  }
  if (impact.paymentCount > 0) {
    parts.push(`${impact.paymentCount} payment record(s)`);
  }

  const names = impact.affectedMembers
    .filter((m) => m.status === "ACTIVE")
    .map((m) => m.name || m.phoneNumber || m.uid)
    .slice(0, 10);

  let message =
    `Deleting this package will orphan ${parts.join(" and ")}. ` +
    "Members will see dashboard errors and may be unable to scan or book until their subscriptions are repaired.";

  if (names.length > 0) {
    message += ` Active members: ${names.join(", ")}.`;
  }

  return message;
}

function sampleImpact(
  overrides: Partial<PackageDeletionImpact> = {},
): PackageDeletionImpact {
  return {
    packageId: "abc",
    packageName: "Open Gym Monthly",
    packageCategory: "OPEN_GYM",
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    deletedOrCompletedSubscriptions: 0,
    paymentCount: 0,
    nonRefundedPaymentCount: 0,
    affectedMembers: [],
    warningMessage: "",
    ...overrides,
  };
}

describe("package deletion warning message", () => {
  it("reports no impact when nothing references the package", () => {
    expect(buildWarningMessage(sampleImpact())).toBe(
      "No member subscriptions or payments reference this package.",
    );
  });

  it("lists active members that would be damaged", () => {
    const message = buildWarningMessage(
      sampleImpact({
        totalSubscriptions: 2,
        activeSubscriptions: 2,
        paymentCount: 2,
        nonRefundedPaymentCount: 2,
        affectedMembers: [
          {
            uid: "1",
            name: "ali negm",
            email: null,
            phoneNumber: "01114415501",
            pkgStartDate: new Date(),
            pkgEndDate: new Date(),
            status: "ACTIVE",
            remainingClasses: 10000,
          },
          {
            uid: "2",
            name: "Tarek Gado",
            email: null,
            phoneNumber: "01158455416",
            pkgStartDate: new Date(),
            pkgEndDate: new Date(),
            status: "ACTIVE",
            remainingClasses: 10000,
          },
        ],
      }),
    );

    expect(message).toContain("2 active member subscription(s)");
    expect(message).toContain("ali negm");
    expect(message).toContain("Tarek Gado");
    expect(message).toContain("dashboard errors");
  });
});
