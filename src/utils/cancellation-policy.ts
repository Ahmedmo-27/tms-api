/**
 * Late-cancellation policy for scheduled-class bookings.
 *
 * A session is deducted from the member's package when they book.
 * - Cancelled more than 3 hours before start → the session is returned.
 * - Cancelled by the member within 3 hours of start → booking is removed but
 *   the session is NOT returned (late cancellation).
 * - Staff (front desk) cancellations always return the session.
 * - Nobody can cancel once the class has started.
 * - Drop-ins keep the existing rule: no cancellation within 3 hours.
 */

export const LATE_CANCELLATION_WINDOW_MS = 3 * 60 * 60 * 1000;

export type CancelledBy = "member" | "staff";

export type CancellationDecision =
  | { allowed: true; returnSession: boolean; lateCancellation: boolean }
  | {
      allowed: false;
      code: "CLASS_ALREADY_STARTED" | "DEADLINE_PASSED";
      message: string;
    };

export function getCancellationDeadline(startTime: Date): Date {
  return new Date(startTime.getTime() - LATE_CANCELLATION_WINDOW_MS);
}

export function resolveCancellation(params: {
  startTime: Date;
  now: Date;
  cancelledBy: CancelledBy;
  /** true when booking took a session from a package (paid, non-workspace, non-drop-in) */
  usesPackageSession: boolean;
  isDropIn: boolean;
}): CancellationDecision {
  const { startTime, now, cancelledBy, usesPackageSession, isDropIn } = params;

  if (now.getTime() >= startTime.getTime()) {
    return {
      allowed: false,
      code: "CLASS_ALREADY_STARTED",
      message: "This class has already started and can't be cancelled.",
    };
  }

  const withinWindow = now.getTime() > getCancellationDeadline(startTime).getTime();

  if (withinWindow && isDropIn) {
    return {
      allowed: false,
      code: "DEADLINE_PASSED",
      message: "Must cancel 3 hours before class start time",
    };
  }

  if (!usesPackageSession) {
    return { allowed: true, returnSession: false, lateCancellation: false };
  }

  const lateCancellation = withinWindow && cancelledBy === "member";
  return { allowed: true, returnSession: !lateCancellation, lateCancellation };
}
