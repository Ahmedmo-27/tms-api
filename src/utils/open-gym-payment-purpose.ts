import { IPayment } from "../models/payment";
import { IPackage } from "../models/package";

type PopulatedPackage = Pick<IPackage, "category" | "name" | "expiryPeriod">;

export function formatOpenGymDurationLabel(expiryPeriod?: number): string | null {
  if (!expiryPeriod || expiryPeriod < 1) return null;
  if (expiryPeriod % 30 === 0) {
    const months = expiryPeriod / 30;
    return months === 1 ? "1 month" : `${months} months`;
  }
  if (expiryPeriod % 7 === 0) {
    const weeks = expiryPeriod / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return expiryPeriod === 1 ? "1 day" : `${expiryPeriod} days`;
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

    const duration = formatOpenGymDurationLabel(pkg.expiryPeriod);
    if (duration) {
      return `Open Gym ${duration} package`;
    }

    return "Open Gym Package";
  }

  return null;
}

export function resolveOpenGymPaymentNote(
  category: string,
  _renewalPeriod?: string,
  name?: string,
  expiryPeriod?: number,
): string | undefined {
  if (category !== "OPEN_GYM") return undefined;
  if (name?.trim()) return name.trim();
  const duration = formatOpenGymDurationLabel(expiryPeriod);
  if (duration) return `Open gym ${duration} package`;
  return "Open gym package";
}
