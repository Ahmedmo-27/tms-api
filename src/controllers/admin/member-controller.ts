import { Request, Response } from "express";
import { Types } from "mongoose";
import Member from "../../models/member";
import User from "../../models/user";
import DeductionLog from "../../models/deductionLog";
import DailyAttendance from "../../models/dailyAttendance";
import { isUnlimitedSpaceAccess } from "../../models/package";
import { NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { SubscriptionsService } from "../../services/subscriptions-service";
import { PackageStatusService } from "../../services/package-status-service";
import { runInTransaction } from "../../utils/transaction";
import { escapeRegex } from "../../utils/escapeRegex";
import { cairoDateKey, isSameCairoDay } from "../../utils/timezone";

export const addMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const id = req.params.id;
  const user = await User.findById(id);
  if (!user)
    throw new NotFoundError("USER_NOT_FOUND", "User not found", { id });

  await runInTransaction(async (session) => {
    let member = await Member.findOne({ uid: id }).session(session ?? null);
    if (!member) {
      member = new Member({
        uid: id,
        packages: [],
        bookings: [],
        attendance: [],
      });
      await member.save(session ? { session } : {});
    }
    user.role = "member";
    await user.save(session ? { session } : {});

    await SubscriptionsService.transferStagedPackagesToMember(
      id,
      user.phoneNumber,
      session
    );
  });

  const member = await Member.findOne({ uid: id }).lean();
  new SuccessResponse("Member Added!", member).send(res);
});

export const getMember = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  // Our Members is intentionally global — all staff roles see members across branches.
  const { uid, limit = "10", page = "1", name, phone, search, pkgId } = req.query;

  const searchTerm = (search || name || phone) ? String(search || name || phone).trim() : "";

  const pageNumber = parseInt(page as string, 10);
  const limitNumber = parseInt(limit as string, 10);
  const skip = (pageNumber - 1) * limitNumber;

  const memberQuery: any = {
    isActive: { $ne: false },
  };

  if (uid && !searchTerm && Types.ObjectId.isValid(uid as string)) {
    memberQuery.uid = new Types.ObjectId(uid as string);
  } else if (searchTerm || (uid && Types.ObjectId.isValid(uid as string))) {
    const userQuery: any = {};
    if (uid && Types.ObjectId.isValid(uid as string)) {
      userQuery._id = new Types.ObjectId(uid as string);
    }
    if (searchTerm) {
      const escaped = escapeRegex(searchTerm);
      const cleanPhone = searchTerm.replace(/[\s\-+]/g, "");
      const orConditions: any[] = [
        { name: { $regex: escaped, $options: "i" } },
        { phoneNumber: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
      if (cleanPhone && cleanPhone !== searchTerm) {
        orConditions.push({ phoneNumber: { $regex: escapeRegex(cleanPhone), $options: "i" } });
      }
      userQuery.$or = orConditions;
    }

    const users = await User.find(userQuery).select("_id").lean();
    if (!users || users.length === 0) {
      new SuccessResponse("No members found", { members: [], total: 0 }).send(res);
      return;
    }
    memberQuery.uid = { $in: users.map((user) => user._id as Types.ObjectId) };
  }

  if (pkgId && Types.ObjectId.isValid(pkgId as string)) {
    memberQuery.packages = {
      $elemMatch: {
        pkgId: new Types.ObjectId(pkgId as string),
        status: "ACTIVE",
        pkgEndDate: { $gte: new Date() },
      },
    };
  }

  let [members, total] = await Promise.all([
    Member.find(memberQuery)
      .populate({ path: "uid", select: "-password -tokens -resetCode -fcmTokens" })
      .populate({ path: "packages.pkgId" })
      .populate({ path: "ptAttendance.pkgId" })
      .sort({ createdAt: -1 })
      .limit(limitNumber)
      .skip(skip),
    Member.countDocuments(memberQuery),
  ]);

  members = await Member.populate(members, [
    {
      path: "bookings.scid",
      model: "ScheduledClass",
      select: "startTime cid",
      populate: [
        {
          path: "cid",
          model: "Class",
          select: "title",
        },
      ],
    },
    {
      path: "attendance.scid",
      model: "ScheduledClass",
      select: "startTime endTime cid coachId locationId bookedMembers scans",
      populate: [
        {
          path: "cid",
          model: "Class",
          select: "title category points price",
        },
        {
          path: "coachId",
          model: "Coach",
          select: "coachName name",
        },
        {
          path: "locationId",
          model: "Location",
          select: "branchName location",
        },
      ],
    },
  ]);

  members = members.filter((m) => m && m.uid != null);

  const fetchedUids = members
    .map((m) => (m.uid as any)?._id)
    .filter((id): id is Types.ObjectId => Boolean(id));

  const [deductionLogs, dailyDocs] =
    fetchedUids.length > 0
      ? await Promise.all([
          DeductionLog.find({ memberId: { $in: fetchedUids } })
            .sort({ createdAt: -1 })
            .lean(),
          DailyAttendance.find({
            $or: [
              { "ptAttendance.uid": { $in: fetchedUids } },
              { "openGymAttendance.uid": { $in: fetchedUids } },
            ],
          }).lean(),
        ])
      : [[], []];

  const logsByMember = new Map<string, any[]>();
  for (const log of deductionLogs) {
    const key = log.memberId?.toString();
    if (!key) continue;
    const list = logsByMember.get(key) ?? [];
    list.push(log);
    logsByMember.set(key, list);
  }

  const dailyPtByMember = new Map<string, any[]>();
  const dailyOgByMember = new Map<string, any[]>();
  for (const doc of dailyDocs) {
    for (const entry of doc.ptAttendance ?? []) {
      if (entry.status !== "SUCCESS" || !entry.uid) continue;
      const key = entry.uid.toString();
      const list = dailyPtByMember.get(key) ?? [];
      list.push(entry);
      dailyPtByMember.set(key, list);
    }
    for (const entry of doc.openGymAttendance ?? []) {
      if (entry.status !== "SUCCESS" || !entry.uid) continue;
      const key = entry.uid.toString();
      const list = dailyOgByMember.get(key) ?? [];
      list.push(entry);
      dailyOgByMember.set(key, list);
    }
  }

  const enrichedMembers = members.map((member) => {
    const isDirty = PackageStatusService.syncMemberPackageStatuses(member);
    if (isDirty) {
      member.save().catch(() => {
        // Silently catch background save error to avoid blocking the response
      });
    }

    const m: any = member.toObject();
    const memberUidStr = m.uid?._id?.toString() ?? String(m.uid ?? "");

    if (m.bookings) {
      m.bookings = m.bookings.filter(
        (b: any) => b.scid && typeof b.scid === "object" && b.scid._id
      );
    }

    const pkgs: any[] = Array.isArray(m.packages) ? m.packages : [];
    const getPkgIdStr = (p: any) =>
      p?.pkgId?._id?.toString() ?? p?.pkgId?.toString() ?? "";
    const getPkgName = (p: any) =>
      p?.pkgId?.name ?? p?.name ?? "Package";

    for (const p of pkgs) {
      if (!Array.isArray(p.adjustmentHistory)) {
        p.adjustmentHistory = [];
      }
      if (!Array.isArray(p.attendance)) {
        p.attendance = [];
      }
    }

    const safeDayKey = (val: any): string => {
      if (!val) return "";
      const d = new Date(val);
      if (isNaN(d.getTime())) return "";
      return cairoDateKey(d);
    };

    const hasDeductionOnDay = (
      p: any,
      dayKey: string,
      sources?: string[],
      className?: string
    ): boolean => {
      if (!dayKey) return false;
      const targetNameLower = className ? className.trim().toLowerCase() : "";
      return (p.adjustmentHistory as any[]).some((r: any) => {
        if (!r || r.type !== "DEDUCT") return false;
        if (sources && sources.length > 0 && !sources.includes(r.source)) {
          return false;
        }
        const rDay = safeDayKey(r.attendanceDate ?? r.date);
        if (rDay !== dayKey) return false;
        if (targetNameLower) {
          const rName = (r.className || r.reason || "").toLowerCase();
          return rName.includes(targetNameLower);
        }
        return true;
      });
    };

    const findMatchingPkg = (
      pkgIdStr?: string,
      startDate?: any,
      eventDate?: any,
      pkgNameHint?: string
    ): any | undefined => {
      if (pkgIdStr && startDate) {
        const exact = pkgs.find(
          (p) =>
            getPkgIdStr(p) === pkgIdStr &&
            p.pkgStartDate &&
            isSameCairoDay(new Date(p.pkgStartDate), startDate)
        );
        if (exact) return exact;
      }
      const eventMs = eventDate ? new Date(eventDate).getTime() : NaN;
      if (pkgIdStr) {
        const byId = pkgs.filter((p) => getPkgIdStr(p) === pkgIdStr);
        if (byId.length === 1) return byId[0];
        if (byId.length > 1 && !isNaN(eventMs)) {
          const inWindow = byId.find((p) => {
            const s = new Date(p.pkgStartDate).getTime() - 86400000;
            const e = new Date(p.pkgEndDate).getTime() + 86400000;
            return eventMs >= s && eventMs <= e;
          });
          if (inWindow) return inWindow;
        }
        if (byId.length > 0) return byId[byId.length - 1];
      }
      if (pkgNameHint) {
        const hintLower = pkgNameHint.trim().toLowerCase();
        const byName = pkgs.filter(
          (p) => getPkgName(p).trim().toLowerCase() === hintLower
        );
        if (byName.length === 1) return byName[0];
        if (byName.length > 1 && !isNaN(eventMs)) {
          const inWindow = byName.find((p) => {
            const s = new Date(p.pkgStartDate).getTime() - 86400000;
            const e = new Date(p.pkgEndDate).getTime() + 86400000;
            return eventMs >= s && eventMs <= e;
          });
          if (inWindow) return inWindow;
        }
        if (byName.length > 0) return byName[byName.length - 1];
      }
      return undefined;
    };

    // 1. Merge Coach DeductionLog entries into package adjustmentHistory
    const memberLogs = logsByMember.get(memberUidStr) ?? [];
    for (const log of memberLogs) {
      const logPkgId = log.pkgId?.toString();
      const targetPkg = findMatchingPkg(
        logPkgId,
        log.memberPackageStartDate,
        log.sessionDate
      );
      if (!targetPkg) continue;

      const dayKey = safeDayKey(log.sessionDate);
      const alreadyLogged = (targetPkg.adjustmentHistory as any[]).some(
        (r: any) => {
          if (!r || r.type !== "DEDUCT") return false;
          const rDay = safeDayKey(r.attendanceDate ?? r.date);
          if (
            rDay === dayKey &&
            (r.source === "COACH" || r.source === "ADMIN") &&
            (r.reason || "").trim().toLowerCase() ===
              (log.reason || "").trim().toLowerCase()
          ) {
            return true;
          }
          if (
            r.source === "COACH" &&
            log.createdAt &&
            r.date &&
            Math.abs(
              new Date(r.date).getTime() - new Date(log.createdAt).getTime()
            ) < 60000
          ) {
            return true;
          }
          return false;
        }
      );

      const pkgName = getPkgName(targetPkg);
      if (!alreadyLogged) {
        targetPkg.adjustmentHistory.push({
          date: log.createdAt ?? log.sessionDate,
          attendanceDate: log.sessionDate,
          className: pkgName,
          amount: 1,
          type: "DEDUCT",
          source: "COACH",
          reason: log.reason || `Coach deduction: ${pkgName}`,
        });
      }
    }

    // 2. Merge Member.ptAttendance and DailyAttendance.ptAttendance into adjustmentHistory & ptAttendance
    const ptList: any[] = Array.isArray(m.ptAttendance) ? m.ptAttendance : [];
    const seenPtDayPkg = new Set<string>();

    for (const pt of ptList) {
      if (!pt) continue;
      const ptPkgId = pt.pkgId?._id?.toString() ?? pt.pkgId?.toString() ?? "";
      const attTime = pt.attendanceTime ?? pt.date;
      const dayKey = safeDayKey(attTime);
      const targetPkg = findMatchingPkg(
        ptPkgId,
        undefined,
        attTime,
        pt.pkgId?.name
      );
      const pkgName =
        pt.pkgId?.name ?? (targetPkg ? getPkgName(targetPkg) : "PT Attendance");
      if (dayKey) {
        seenPtDayPkg.add(`${dayKey}:${pkgName.toLowerCase().trim()}`);
      }
      if (
        targetPkg &&
        dayKey &&
        !hasDeductionOnDay(targetPkg, dayKey, [
          "PT_ATTENDANCE",
          "COACH",
          "ADMIN",
        ])
      ) {
        targetPkg.adjustmentHistory.push({
          date: attTime,
          attendanceDate: attTime,
          className: pkgName,
          amount: 1,
          type: "DEDUCT",
          source: "PT_ATTENDANCE",
          reason: `PT attendance: ${pkgName}`,
        });
      }
    }

    const dailyPtEntries = dailyPtByMember.get(memberUidStr) ?? [];
    for (const entry of dailyPtEntries) {
      const method = (entry.method || "").trim();
      const methodLower = method.toLowerCase();
      if (
        !method ||
        methodLower === "no active package" ||
        methodLower.includes("drop in") ||
        methodLower.includes("drop-in") ||
        methodLower.includes("dropin")
      ) {
        continue;
      }
      const dayKey = safeDayKey(entry.time);
      const targetPkg = findMatchingPkg(undefined, undefined, entry.time, method);
      const pkgName = targetPkg ? getPkgName(targetPkg) : method;
      const dedupeKey = `${dayKey}:${pkgName.toLowerCase().trim()}`;

      if (dayKey && !seenPtDayPkg.has(dedupeKey)) {
        seenPtDayPkg.add(dedupeKey);
        ptList.push({
          pkgId: targetPkg?.pkgId ?? { name: pkgName },
          attendanceTime: entry.time,
          date: dayKey,
        });
      }

      if (
        targetPkg &&
        dayKey &&
        !hasDeductionOnDay(targetPkg, dayKey, [
          "PT_ATTENDANCE",
          "COACH",
          "ADMIN",
        ])
      ) {
        targetPkg.adjustmentHistory.push({
          date: entry.time,
          attendanceDate: entry.time,
          className: pkgName,
          amount: 1,
          type: "DEDUCT",
          source: "PT_ATTENDANCE",
          reason: `PT attendance: ${pkgName}`,
        });
      }
    }

    // 3. Merge DailyAttendance.openGymAttendance into adjustmentHistory
    const dailyOgEntries = dailyOgByMember.get(memberUidStr) ?? [];
    for (const entry of dailyOgEntries) {
      const method = (entry.method || "").trim();
      const methodLower = method.toLowerCase();
      if (
        !method ||
        methodLower === "no active package" ||
        methodLower === "no access at location" ||
        methodLower.includes("drop in") ||
        methodLower.includes("drop-in") ||
        methodLower.includes("dropin")
      ) {
        continue;
      }
      const dayKey = safeDayKey(entry.time);
      const targetPkg = findMatchingPkg(undefined, undefined, entry.time, method);
      if (!targetPkg || !dayKey) continue;
      const pkgName = getPkgName(targetPkg);
      const category = targetPkg.pkgId?.category ?? "";
      const unlimited = isUnlimitedSpaceAccess(category);

      if (!hasDeductionOnDay(targetPkg, dayKey, ["SPACE_WALK"])) {
        targetPkg.adjustmentHistory.push({
          date: entry.time,
          attendanceDate: entry.time,
          className: pkgName,
          amount: unlimited ? 0 : 1,
          type: "DEDUCT",
          source: "SPACE_WALK",
          reason:
            category === "OPEN_GYM"
              ? "Open gym visit"
              : unlimited
                ? "Space walk-in (unlimited)"
                : "Space walk-in",
        });
      }
    }

    // 4. Merge Member.attendance (attended scheduled classes) into adjustmentHistory & attendance
    const classAttList: any[] = Array.isArray(m.attendance) ? m.attendance : [];
    for (const att of classAttList) {
      const sc: any = att?.scid;
      if (!sc || typeof sc !== "object" || !sc._id) continue;
      const cls: any = sc.cid;
      const classTitle = cls?.title ?? sc.className ?? "Scheduled Class";
      const startTime = sc.startTime;
      const dayKey = safeDayKey(startTime);

      const bookedEntry = (sc.bookedMembers ?? []).find(
        (b: any) => (b.uid?._id ?? b.uid)?.toString() === memberUidStr
      );
      const scanEntry = (sc.scans ?? []).find(
        (s: any) =>
          (s.uid?._id ?? s.uid)?.toString() === memberUidStr &&
          s.status === true
      );
      const methodStr = (
        bookedEntry?.method ||
        scanEntry?.method ||
        ""
      ).trim();
      const methodLower = methodStr.toLowerCase();
      const isDropInOrFree =
        methodLower === "drop in" ||
        methodLower === "walk in" ||
        cls?.price === 0 ||
        cls?.category === "WORKSPACE";

      let targetPkg = methodStr && !isDropInOrFree
        ? findMatchingPkg(undefined, undefined, startTime, methodStr)
        : undefined;

      if (!targetPkg && !isDropInOrFree && cls?._id) {
        const cidStr = cls._id.toString();
        const openingPkgs = pkgs.filter((p) => {
          const opens: any[] = p.pkgId?.opensClasses ?? [];
          return opens.some(
            (id: any) => (id?._id ?? id)?.toString() === cidStr
          );
        });
        if (openingPkgs.length === 1) {
          targetPkg = openingPkgs[0];
        } else if (openingPkgs.length > 1 && startTime) {
          const ms = new Date(startTime).getTime();
          targetPkg =
            openingPkgs.find((p) => {
              const s = new Date(p.pkgStartDate).getTime() - 86400000;
              const e = new Date(p.pkgEndDate).getTime() + 86400000;
              return ms >= s && ms <= e;
            }) ?? openingPkgs[openingPkgs.length - 1];
        }
      }

      if (targetPkg && dayKey && !isDropInOrFree) {
        const alreadyBookedOrAttended = hasDeductionOnDay(
          targetPkg,
          dayKey,
          ["BOOKING", "ATTENDANCE", "ADMIN"],
          classTitle
        );
        if (!alreadyBookedOrAttended) {
          const points = Number(cls?.points) || 1;
          targetPkg.adjustmentHistory.push({
            date: scanEntry?.scanTime ?? startTime,
            attendanceDate: startTime,
            className: classTitle,
            amount: points,
            type: "DEDUCT",
            source: "ATTENDANCE",
            reason: `Attended class: ${classTitle}`,
          });
        }
      }

      // Also include attended class in ptAttendance / unified attendance if not already present
      const attTime = scanEntry?.scanTime ?? startTime;
      if (attTime) {
        const label = targetPkg
          ? `${classTitle} (${getPkgName(targetPkg)})`
          : classTitle;
        const dedupeKey = `${dayKey}:${label.toLowerCase().trim()}`;
        if (!seenPtDayPkg.has(dedupeKey)) {
          seenPtDayPkg.add(dedupeKey);
          ptList.push({
            pkgId: {
              _id: targetPkg ? getPkgIdStr(targetPkg) : sc._id.toString(),
              name: label,
            },
            attendanceTime: attTime,
            date: dayKey,
            type: "CLASS",
            className: classTitle,
            packageName: targetPkg ? getPkgName(targetPkg) : methodStr || "Class",
          });
        }
      }
    }

    // 5. Build per-package attendance list from PT attendance + attendance-based adjustmentHistory
    for (const p of pkgs) {
      const pIdStr = getPkgIdStr(p);
      const pName = getPkgName(p);
      const seenAtt = new Set<string>();
      const bundledAtt: { className: string; attendanceDate: any }[] = [];

      const addAtt = (className: string, attendanceDate: any) => {
        if (!attendanceDate) return;
        const dKey = safeDayKey(attendanceDate);
        const key = `${dKey}:${(className || pName).toLowerCase().trim()}`;
        if (seenAtt.has(key)) return;
        seenAtt.add(key);
        bundledAtt.push({
          className: className || pName,
          attendanceDate,
        });
      };

      for (const rec of ptList) {
        if (!rec) continue;
        const recPkgId =
          rec.pkgId?._id?.toString() ?? rec.pkgId?.toString() ?? "";
        if (recPkgId === pIdStr) {
          addAtt(
            rec.className ?? rec.pkgId?.name ?? pName,
            rec.attendanceTime ?? rec.date
          );
        }
      }

      for (const adj of p.adjustmentHistory ?? []) {
        if (!adj || adj.type !== "DEDUCT") continue;
        const reasonLower = (adj.reason || "").trim().toLowerCase();
        const isAttendanceAdj =
          adj.source === "PT_ATTENDANCE" ||
          adj.source === "ATTENDANCE" ||
          adj.source === "SPACE_WALK" ||
          adj.source === "BOOKING" ||
          ((adj.source === "COACH" || adj.source === "ADMIN") &&
            (reasonLower.startsWith("completed session") ||
              reasonLower.startsWith("makeup") ||
              reasonLower.startsWith("attended")));
        if (isAttendanceAdj) {
          addAtt(
            adj.className || adj.reason || pName,
            adj.attendanceDate ?? adj.date
          );
        }
      }

      bundledAtt.sort(
        (a, b) =>
          new Date(b.attendanceDate).getTime() -
          new Date(a.attendanceDate).getTime()
      );
      p.attendance = bundledAtt;

      p.adjustmentHistory.sort(
        (a: any, b: any) =>
          new Date(b.attendanceDate ?? b.date).getTime() -
          new Date(a.attendanceDate ?? a.date).getTime()
      );
    }

    ptList.sort(
      (a: any, b: any) =>
        new Date(b.attendanceTime ?? b.date ?? 0).getTime() -
        new Date(a.attendanceTime ?? a.date ?? 0).getTime()
    );
    m.ptAttendance = ptList;

    return m;
  });

  new SuccessResponse("Members Found!", {
    members: enrichedMembers,
    total,
  }).send(res);
});

