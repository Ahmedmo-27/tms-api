import { Types } from "mongoose";

export const LEGACY_OPEN_GYM_PAYLOAD = "opengym";
const BRANCH_OPEN_GYM_PATTERN = /^opengym:(.+)$/;

export type ScanPayload =
  | { type: "pt" }
  | { type: "legacy_open_gym" }
  | { type: "branch_open_gym"; locationId: string }
  | { type: "scheduled_class"; scheduledClassId: string }
  | { type: "invalid" };

export function parseScanPayload(attendanceId: string): ScanPayload {
  if (attendanceId === "pt") {
    return { type: "pt" };
  }
  if (attendanceId === LEGACY_OPEN_GYM_PAYLOAD) {
    return { type: "legacy_open_gym" };
  }

  const branchMatch = attendanceId.match(BRANCH_OPEN_GYM_PATTERN);
  if (branchMatch) {
    return { type: "branch_open_gym", locationId: branchMatch[1] };
  }

  if (Types.ObjectId.isValid(attendanceId)) {
    return { type: "scheduled_class", scheduledClassId: attendanceId };
  }

  return { type: "invalid" };
}

export function isValidOpenGymLocationId(locationId: string): boolean {
  return Boolean(locationId) && Types.ObjectId.isValid(locationId);
}
