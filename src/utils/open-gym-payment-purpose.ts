import { IPayment } from "../models/payment";
import { IPackage } from "../models/package";

type PopulatedPackage = Pick<IPackage, "category" | "renewalPeriod" | "name">;

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

    if (pkg.renewalPeriod === "WEEKLY") {
      return "Open Gym Weekly Package";
    }
    if (pkg.renewalPeriod === "MONTHLY") {
      return "Open Gym Monthly Package";
    }

    return pkg.name ?? "Open Gym Package";
  }

  return null;
}

export function resolveOpenGymPaymentNote(
  category: string,
  renewalPeriod?: string,
): string | undefined {
  if (category !== "OPEN_GYM") return undefined;
  if (renewalPeriod === "WEEKLY") return "Open gym weekly package";
  if (renewalPeriod === "MONTHLY") return "Open gym monthly package";
  return "Open gym package";
}
