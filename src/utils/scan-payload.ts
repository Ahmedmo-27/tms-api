import { Types } from "mongoose";

export const LEGACY_OPEN_GYM_PAYLOAD = "opengym";
export const LEGACY_PT_PAYLOAD = "pt";
const BRANCH_OPEN_GYM_PATTERN = /^opengym:(.+)$/;
const BRANCH_PT_PATTERN = /^pt:(.+)$/;

export type ScanPayload =
  | { type: "pt" }
  | { type: "branch_pt"; locationId: string }
  | { type: "legacy_open_gym" }
  | { type: "branch_open_gym"; locationId: string }
  | { type: "scheduled_class"; scheduledClassId: string }
  | { type: "invalid" };

export function parseScanPayload(attendanceId: string): ScanPayload {
  if (attendanceId === LEGACY_PT_PAYLOAD) {
    return { type: "pt" };
  }

  const branchPtMatch = attendanceId.match(BRANCH_PT_PATTERN);
  if (branchPtMatch) {
    return { type: "branch_pt", locationId: branchPtMatch[1] };
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

/** Alias — same ObjectId check used for branch PT and open gym QRs. */
export const isValidScanLocationId = isValidOpenGymLocationId;
