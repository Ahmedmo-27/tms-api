import { Types } from "mongoose";
import Member from "../models/member";
import Package from "../models/package";
import Payment from "../models/payment";
import User from "../models/user";

export interface AffectedMemberSubscription {
  uid: string;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  pkgStartDate: Date;
  pkgEndDate: Date;
  status: string;
  remainingClasses: number;
}

export interface PackageDeletionImpact {
  packageId: string;
  packageName: string | null;
  packageCategory: string | null;
  totalSubscriptions: number;
  activeSubscriptions: number;
  deletedOrCompletedSubscriptions: number;
  paymentCount: number;
  nonRefundedPaymentCount: number;
  affectedMembers: AffectedMemberSubscription[];
  warningMessage: string;
}

function buildWarningMessage(impact: Omit<PackageDeletionImpact, "warningMessage">): string {
  if (impact.totalSubscriptions === 0 && impact.paymentCount === 0) {
    return "No member subscriptions or payments reference this package.";
  }

  const parts: string[] = [];
  if (impact.activeSubscriptions > 0) {
    parts.push(
      `${impact.activeSubscriptions} active member subscription(s)`,
    );
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
    message += ` Active members: ${names.join(", ")}`;
    if (impact.activeSubscriptions > names.length) {
      message += `, and ${impact.activeSubscriptions - names.length} more`;
    }
    message += ".";
  }

  return message;
}

export async function getPackageDeletionImpact(
  packageId: string,
): Promise<PackageDeletionImpact> {
  if (!Types.ObjectId.isValid(packageId)) {
    throw new Error(`Invalid package id: ${packageId}`);
  }

  const pkgObjectId = new Types.ObjectId(packageId);
  const pkg = await Package.findById(pkgObjectId).lean();

  const members = await Member.find({
    "packages.pkgId": pkgObjectId,
  }).lean();

  const payments = await Payment.find({ pkgId: pkgObjectId }).lean();

  const affectedMembers: AffectedMemberSubscription[] = [];

  for (const member of members) {
    const matchingPackages = (member.packages || []).filter(
      (p) => p.pkgId.toString() === packageId,
    );
    if (matchingPackages.length === 0) continue;

    const user = await User.findById(member.uid).lean();

    for (const subscription of matchingPackages) {
      affectedMembers.push({
        uid: member.uid.toString(),
        name: user?.name ?? null,
        email: user?.email ?? null,
        phoneNumber: user?.phoneNumber ?? null,
        pkgStartDate: subscription.pkgStartDate,
        pkgEndDate: subscription.pkgEndDate,
        status: subscription.status,
        remainingClasses: subscription.remainingClasses,
      });
    }
  }

  const activeSubscriptions = affectedMembers.filter(
    (m) => m.status === "ACTIVE",
  ).length;
  const totalSubscriptions = affectedMembers.length;
  const deletedOrCompletedSubscriptions =
    totalSubscriptions - activeSubscriptions;
  const nonRefundedPaymentCount = payments.filter((p) => !p.isRefunded).length;

  const base = {
    packageId,
    packageName: pkg?.name ?? null,
    packageCategory: pkg?.category ?? null,
    totalSubscriptions,
    activeSubscriptions,
    deletedOrCompletedSubscriptions,
    paymentCount: payments.length,
    nonRefundedPaymentCount,
    affectedMembers,
  };

  return {
    ...base,
    warningMessage: buildWarningMessage(base),
  };
}
