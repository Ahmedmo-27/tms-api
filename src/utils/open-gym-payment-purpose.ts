import { IPayment } from "../models/payment";
import { IPackage, OpenGymRenewalPeriod } from "../models/package";

type PopulatedPackage = Pick<IPackage, "category" | "renewalPeriod" | "name">;

const OPEN_GYM_RENEWAL_LABELS: Record<OpenGymRenewalPeriod, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "2-Week",
  TRIWEEKLY: "3-Week",
  MONTHLY: "Monthly",
  BIMONTHLY: "2-Month",
  TRIMONTHLY: "3-Month",
};

function renewalLabel(renewalPeriod?: string): string | null {
  if (!renewalPeriod) return null;
  return (
    OPEN_GYM_RENEWAL_LABELS[renewalPeriod as OpenGymRenewalPeriod] ?? null
  );
}

export function resolveOpenGymPaymentPurposeLabel(payment: {
  purpose: IPayment["purpose"];
  note?: string;
  pkgId?: unknown;
}): string | null {
  if (
    payment.purpose === "DROPIN" &&
    payment.note?.toLowerCase().includes("open gym")
  ) {
    return "Open Gym Drop-in";
  }

  if (payment.purpose === "PACKAGE" && payment.pkgId) {
    const pkg = payment.pkgId as PopulatedPackage;
    if (pkg.category !== "OPEN_GYM") return null;

    if (pkg.name?.trim()) {
      return pkg.name;
    }

    const label = renewalLabel(pkg.renewalPeriod);
    if (label) {
      return `Open Gym ${label} Package`;
    }

    return "Open Gym Package";
  }

  return null;
}

export function resolveOpenGymPaymentNote(
  category: string,
  renewalPeriod?: string,
  name?: string,
): string | undefined {
  if (category !== "OPEN_GYM") return undefined;
  if (name?.trim()) return name.trim();
  const label = renewalLabel(renewalPeriod);
  if (label) return `Open gym ${label.toLowerCase()} package`;
  return "Open gym package";
}
