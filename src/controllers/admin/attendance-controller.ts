import { Request, Response } from "express";
import Member from "../../models/member";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { resolveLocationFilter } from "../../utils/location-scope";

type AttendanceRow = {
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: "CLASS" | "PT";
  className: string;
  coachName?: string;
  refId: string;
  attendanceTime: Date;
};

export const getAttendanceHistory = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const {
    startDate,
    endDate,
    page = "1",
    limit = "25",
    type,
    memberName,
  } = req.query;

  const targetLocationId = resolveLocationFilter(req);

  const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNumber = Math.max(1, parseInt(limit as string, 10) || 25);

  const { startOfDateCairo, endOfDateCairo } = await import("../../utils/timezone");
  const start = startDate ? startOfDateCairo(startDate as string) : null;
  const end = endDate ? endOfDateCairo(endDate as string) : null;

  const members = await Member.find({ isActive: true })
    .populate("uid")
    .populate({
      path: "attendance.scid",
      model: "ScheduledClass",
      populate: [
        { path: "coachId", model: "Coach" },
        { path: "cid", model: "Class" },
      ],
    })
    .populate({ path: "ptAttendance.pkgId", model: "Package" });

  const rows: AttendanceRow[] = [];

  for (const member of members) {
    const user = member.uid as any;
    if (!user) continue;
    const name = user.name || "—";
    if (
      memberName &&
      !name.toLowerCase().includes((memberName as string).toLowerCase())
    ) {
      continue;
    }
    const phone = user.phoneNumber || "";
    const memberId = user._id?.toString() || "";

    if (type !== "PT") {
      for (const att of member.attendance || []) {
        const sc: any = att.scid;
        if (!sc || typeof sc !== "object") continue;
        if (targetLocationId && sc.locationId?.toString() !== targetLocationId) continue;
        const time: Date = sc.startTime ? new Date(sc.startTime) : new Date(0);
        if (start && time < start) continue;
        if (end && time > end) continue;
        rows.push({
          memberId,
          memberName: name,
          memberPhone: phone,
          type: "CLASS",
          className: sc.cid?.title || "—",
          coachName: Array.isArray(sc.coachId) ? sc.coachId.map((c: any) => c.name).filter(Boolean).join(", ") || undefined : (sc.coachId?.name || undefined),
          refId: sc._id?.toString() || "",
          attendanceTime: time,
        });
      }
    }

    if (type !== "CLASS") {
      for (const pt of member.ptAttendance || []) {
        const time: Date = pt.attendanceTime
          ? new Date(pt.attendanceTime)
          : new Date(0);
        if (start && time < start) continue;
        if (end && time > end) continue;
        const pkg: any = pt.pkgId;
        
        if (targetLocationId) {
          const memberPkg = member.packages?.find((p: any) => p.pkgId?.toString() === pkg?._id?.toString());
          if (!memberPkg || memberPkg.locationId?.toString() !== targetLocationId) continue;
        }
        rows.push({
          memberId,
          memberName: name,
          memberPhone: phone,
          type: "PT",
          className: pkg?.name || "PT Session",
          refId: pkg?._id?.toString() || "",
          attendanceTime: time,
        });
      }
    }
  }

  rows.sort(
    (a, b) => b.attendanceTime.getTime() - a.attendanceTime.getTime()
  );

  const total = rows.length;
  const skip = (pageNumber - 1) * limitNumber;
  const paged = rows.slice(skip, skip + limitNumber);

  new SuccessResponse("Attendance history fetched", {
    records: paged,
    total,
  }).send(res);
});
