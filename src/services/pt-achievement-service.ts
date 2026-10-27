import { Types } from "mongoose";
import Coach from "../models/coach";
import Member from "../models/member";
import Package from "../models/package";
import Payment from "../models/payment";
import DeductionLog from "../models/deductionLog";
import User from "../models/user";
import {
  startOfDateCairo,
  endOfDateCairo,
  cairoDayRange,
  CAIRO_TZ,
  cairoDaysUntil,
  cairoDateKey,
} from "../utils/timezone";
import { cairoKey, round2 } from "../utils/finance-range";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { startOfWeek, endOfWeek } from "date-fns";

const NON_REVENUE_METHODS = ["DEDUCTED", "TRANSFERRED", "ADJUSTED"];

const COACH_ALIAS_GROUPS: string[][] = [
  ["Youssef", "Youssef Khaled"],
  ["Hana Minisy", "Hana Minissy", "Hana Elmeneisy"],
  ["Salma", "Salma Ghazzawi"],
  ["Omar El Alamy", "Omar ElAlamy", "Omar Alamy"],
];

function getCoachNameVariants(rawName?: string | null): string[] {
  if (!rawName) return [];
  const trimmed = rawName.trim();
  if (!trimmed) return [];
  const norm = trimmed.toLowerCase().replace(/\s+/g, " ");
  const noSpace = norm.replace(/\s+/g, "");
  const variants = new Set<string>([trimmed]);

  for (const group of COACH_ALIAS_GROUPS) {
    const matchesGroup = group.some((alias) => {
      const aNorm = alias.toLowerCase().replace(/\s+/g, " ");
      const aNoSpace = aNorm.replace(/\s+/g, "");
      return aNorm === norm || aNoSpace === noSpace;
    });
    if (matchesGroup) {
      for (const alias of group) {
        variants.add(alias);
      }
    }
  }
  return Array.from(variants);
}

// In-memory cache for fast repeated views
const CACHE_TTL_MS = 45 * 1000;
const cache = new Map<string, { at: number; value: PtAchievementReport }>();

export interface PtAchievementParams {
  filterType: "weekly" | "monthly" | "date";
  date?: string;       // yyyy-MM-dd (for weekly mode)
  month?: string;      // yyyy-MM (for monthly mode)
  startDate?: string;  // yyyy-MM-dd (for date mode)
  endDate?: string;    // yyyy-MM-dd (for date mode)
  coachId?: string;    // optional: drill down into single coach doc ID
}

export interface PtAchievementReport {
  range: { startDate: string; endDate: string; filterType: string };
  totals: {
    sessions: number;
    scanSessions: number;
    deductionSessions: number;
    boughtPackages: number;
    boughtRevenue: number;
    activeClients: number;
    remainingSessions: number;
    lowBalanceClients: number;
    expiringSoon: number;
  };
  coaches: CoachAchievementRow[];
  expiringSoonPackages?: ExpiringPackageItem[];
  selectedCoach?: {
    coachId: string;
    coachName: string;
    boughtPackages: BoughtPackageItem[];
    deliveredSessions: DeliveredSessionItem[];
    activeClients: ClientBalanceItem[];
  };
}

export interface ExpiringPackageItem {
  memberId: string;
  memberName: string;
  phone: string;
  coachId: string;
  coachName: string;
  packageName: string;
  packageId: string;
  remainingSessions: number;
  pkgEndDate: string;
  daysUntilExpiry: number;
  isLowBalance: boolean;
  isExpiringSoon: boolean;
  status: string;
}

export interface CoachAchievementRow {
  coachId: string;
  coachName: string;
  sessions: number;
  scanSessions: number;
  deductionSessions: number;
  boughtPackages: number;
  boughtRevenue: number;
  activeClients: number;
  remainingSessions: number;
  lowBalanceClients: number;
  expiringSoon: number;
}

export interface BoughtPackageItem {
  paymentId: string;
  memberId: string | null;
  memberName: string;
  phone: string;
  packageName: string;
  packageId: string;
  amount: number;
  numberOfSessions: number;
  paymentDate: string;
  remainingSessions: number | null;
  packageStatus: string | null;
}

export interface DeliveredSessionItem {
  id: string;
  date: string;
  source: "SCAN" | "COACH_DEDUCTION";
  memberId: string;
  memberName: string;
  phone: string;
  packageName: string;
  reason?: string;
}

export interface ClientBalanceItem {
  memberId: string;
  memberName: string;
  phone: string;
  packageName: string;
  packageId: string;
  remainingSessions: number;
  pkgEndDate: string;
  status: string;
  daysUntilExpiry: number;
  isLowBalance: boolean;
  isExpiringSoon: boolean;
}

export class PtAchievementService {
  /**
   * Resolves the start and end date range according to filterType in Cairo timezone.
   */
  static resolveDateRange(params: PtAchievementParams): {
    startDate: Date;
    endDate: Date;
    startKey: string;
    endKey: string;
  } {
    if (params.filterType === "weekly") {
      const refInstant = params.date ? startOfDateCairo(params.date) : new Date();
      const cairoZoned = toZonedTime(refInstant, CAIRO_TZ);
      const day = cairoZoned.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;

      const mondayZoned = new Date(cairoZoned);
      mondayZoned.setDate(mondayZoned.getDate() + diffToMonday);

      const sundayZoned = new Date(mondayZoned);
      sundayZoned.setDate(sundayZoned.getDate() + 6);

      const startKey = formatInTimeZone(fromZonedTime(mondayZoned, CAIRO_TZ), CAIRO_TZ, "yyyy-MM-dd");
      const endKey = formatInTimeZone(fromZonedTime(sundayZoned, CAIRO_TZ), CAIRO_TZ, "yyyy-MM-dd");
      const startDate = startOfDateCairo(startKey);
      const endDate = endOfDateCairo(endKey);

      return { startDate, endDate, startKey, endKey };
    }

    if (params.filterType === "monthly") {
      let monthStr = params.month ? params.month.trim() : "";
      if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
        monthStr = cairoKey(new Date(), "month");
      }

      const [yStr, mStr] = monthStr.split("-");
      const year = parseInt(yStr, 10);
      const monthNum = parseInt(mStr, 10);
      const lastDay = new Date(year, monthNum, 0).getDate();

      const startKey = `${year}-${String(monthNum).padStart(2, "0")}-01`;
      const endKey = `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const startDate = startOfDateCairo(startKey);
      const endDate = endOfDateCairo(endKey);

      return { startDate, endDate, startKey, endKey };
    }

    // Default: custom date range
    let startKey = params.startDate ? params.startDate.trim() : "";
    let endKey = params.endDate ? params.endDate.trim() : "";

    if (!startKey || !endKey) {
      const currentMonth = cairoKey(new Date(), "month");
      const [yStr, mStr] = currentMonth.split("-");
      const year = parseInt(yStr, 10);
      const monthNum = parseInt(mStr, 10);
      const lastDay = new Date(year, monthNum, 0).getDate();
      if (!startKey) startKey = `${year}-${String(monthNum).padStart(2, "0")}-01`;
      if (!endKey) endKey = `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }

    if (startKey > endKey) {
      const temp = startKey;
      startKey = endKey;
      endKey = temp;
    }

    const startDate = startOfDateCairo(startKey);
    const endDate = endOfDateCairo(endKey);

    return { startDate, endDate, startKey, endKey };
  }

  /**
   * Aggregates PT achievement report in a high-performance batch query.
   */
  static async getReport(params: PtAchievementParams): Promise<PtAchievementReport> {
    const { startDate, endDate, startKey, endKey } = this.resolveDateRange(params);
    const now = new Date();

    const cacheKey = `${params.filterType}|${startKey}|${endKey}|${params.coachId ?? "all"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    // 1. Initial parallel query: load coaches and all PT packages once
    const [coaches, ptPackages] = await Promise.all([
      Coach.find({}).sort({ coachName: 1 }).lean(),
      Package.find({ category: "PERSONAL_TRAINING" })
        .select("_id name numberOfSessions price coachId")
        .lean(),
    ]);

    const allPtPkgIds = ptPackages.map((p) => p._id);
    const ptPkgMap = new Map(ptPackages.map((p) => [p._id.toString(), p]));

    // 2. Fetch all collections in ONE parallel batch (zero per-coach round trips)
    const [allScanMembers, allDeductions, allPayments, allActiveMembers] = await Promise.all([
      Member.find({
        ptAttendance: {
          $elemMatch: {
            pkgId: { $in: allPtPkgIds },
            attendanceTime: { $gte: startDate, $lte: endDate },
          },
        },
      }).select("uid ptAttendance").lean(),

      DeductionLog.find({
        sessionDate: { $gte: startDate, $lte: endDate },
      }).lean(),

      Payment.find({
        pkgId: { $in: allPtPkgIds },
        paymentTime: { $gte: startDate, $lte: endDate },
        paymentMethod: { $nin: NON_REVENUE_METHODS },
      }).lean(),

      Member.find({
        packages: {
          $elemMatch: {
            pkgId: { $in: allPtPkgIds },
            status: "ACTIVE",
            pkgEndDate: { $gt: now },
          },
        },
      }).select("uid packages").lean(),
    ]);

    // 3. Resolve coach IDs & assigned package IDs 100% in-memory (< 5ms)
    const coachMappings = coaches.map((c: any) => {
      const assignedIdSet = new Set<string>();
      assignedIdSet.add(c._id.toString());
      if (c.userId) assignedIdSet.add(c.userId.toString());

      // Link any duplicate / secondary coach documents with matching phone
      const cleanPhone = c.phoneNumber?.replace(/\s/g, "");
      if (cleanPhone && cleanPhone.length >= 8 && cleanPhone !== "01111111111" && cleanPhone !== "00000000000") {
        for (const other of coaches as any[]) {
          if (other.phoneNumber?.replace(/\s/g, "") === cleanPhone) {
            assignedIdSet.add(other._id.toString());
            if (other.userId) assignedIdSet.add(other.userId.toString());
          }
        }
      }

      const nameVariants = getCoachNameVariants(c.coachName);
      const nameVariantsLower = nameVariants.map((v) => v.toLowerCase().trim()).filter((v) => v.length >= 3);

      const pkgIds = new Set<string>();
      for (const p of ptPackages) {
        const pId = p._id.toString();
        const pCoachId = p.coachId ? p.coachId.toString() : null;
        if (pCoachId && assignedIdSet.has(pCoachId)) {
          pkgIds.add(pId);
        } else {
          const pNameLower = (p.name || "").toLowerCase();
          if (nameVariantsLower.some((v) => pNameLower.includes(v))) {
            pkgIds.add(pId);
          }
        }
      }

      return {
        coach: c,
        coachDocIdStr: c._id.toString(),
        assignedIdSet,
        pkgIds,
      };
    });

    // 4. In-memory aggregation
    const coachRows: CoachAchievementRow[] = [];
    const rawExpiringPackages: ExpiringPackageItem[] = [];
    const seenExpiringKey = new Set<string>();
    const globalActiveMemberIds = new Set<string>();
    const globalLowBalanceMemberIds = new Set<string>();
    const globalExpiringSoonMemberIds = new Set<string>();

    let totalSessions = 0;
    let totalScanSessions = 0;
    let totalDeductionSessions = 0;
    let totalBoughtPackages = 0;
    let totalBoughtRevenue = 0;
    let totalRemainingSessions = 0;

    let selectedCoachDetails: PtAchievementReport["selectedCoach"] = undefined;
    const isSingleCoachRequest = Boolean(params.coachId);

    for (const cm of coachMappings) {
      if (cm.pkgIds.size === 0) continue; // skip coaches without any PT packages

      const isSelected = isSingleCoachRequest && cm.coachDocIdStr === params.coachId;

      // Scan sessions in range
      let scanSessions = 0;
      const coachScans: { scan: any; uid: Types.ObjectId }[] = [];

      for (const m of allScanMembers as any[]) {
        for (const att of m.ptAttendance ?? []) {
          if (!att.pkgId) continue;
          const time = new Date(att.attendanceTime);
          if (time >= startDate && time <= endDate && cm.pkgIds.has(att.pkgId.toString())) {
            scanSessions++;
            if (isSelected) {
              coachScans.push({ scan: att, uid: m.uid });
            }
          }
        }
      }

      // Deduction sessions in range
      let deductionSessions = 0;
      const coachDeductions: any[] = [];

      for (const d of allDeductions as any[]) {
        const dCoachId = d.coachId ? d.coachId.toString() : null;
        if (dCoachId && cm.assignedIdSet.has(dCoachId)) {
          deductionSessions++;
          if (isSelected) {
            coachDeductions.push(d);
          }
        }
      }

      const sessions = scanSessions + deductionSessions;

      // Bought packages in range
      let boughtPackages = 0;
      let boughtRevenue = 0;
      const coachPayments: any[] = [];

      for (const p of allPayments as any[]) {
        if (p.pkgId && cm.pkgIds.has(p.pkgId.toString())) {
          boughtPackages++;
          boughtRevenue += Number(p.amount) || 0;
          if (isSelected) {
            coachPayments.push(p);
          }
        }
      }

      // Active clients snapshot
      const coachActiveMemberUids = new Set<string>();
      const coachLowBalanceMemberUids = new Set<string>();
      const coachExpiringSoonMemberUids = new Set<string>();
      let coachRemainingSessions = 0;
      const activeClientBalanceItems: ClientBalanceItem[] = [];

      for (const m of allActiveMembers as any[]) {
        const uidStr = m.uid?.toString();
        for (const pkg of m.packages ?? []) {
          if (!pkg.pkgId || !cm.pkgIds.has(pkg.pkgId.toString())) continue;
          if (pkg.status !== "ACTIVE" || !pkg.pkgEndDate || new Date(pkg.pkgEndDate) <= now) continue;

          if (uidStr) {
            coachActiveMemberUids.add(uidStr);
            globalActiveMemberIds.add(uidStr);
          }

          const rem = pkg.remainingClasses ?? 0;
          coachRemainingSessions += rem;

          const daysUntil = cairoDaysUntil(pkg.pkgEndDate, now);
          const isLow = rem <= 2;
          const isExp = daysUntil >= 0 && daysUntil <= 7;

          if (isLow && uidStr) {
            coachLowBalanceMemberUids.add(uidStr);
            globalLowBalanceMemberIds.add(uidStr);
          }
          if (isExp && uidStr) {
            coachExpiringSoonMemberUids.add(uidStr);
            globalExpiringSoonMemberIds.add(uidStr);
          }

          if (uidStr && (isLow || isExp)) {
            const expKey = `${uidStr}_${pkg._id ? pkg._id.toString() : pkg.pkgId.toString()}_${cm.coachDocIdStr}`;
            if (!seenExpiringKey.has(expKey)) {
              seenExpiringKey.add(expKey);
              rawExpiringPackages.push({
                memberId: uidStr,
                memberName: "",
                phone: "",
                coachId: cm.coachDocIdStr,
                coachName: cm.coach.coachName,
                packageId: pkg.pkgId.toString(),
                packageName: pkg.name || ptPkgMap.get(pkg.pkgId.toString())?.name || "PT Package",
                remainingSessions: rem,
                pkgEndDate: cairoDateKey(pkg.pkgEndDate),
                daysUntilExpiry: daysUntil,
                isLowBalance: isLow,
                isExpiringSoon: isExp,
                status: pkg.status,
              });
            }
          }

          if (isSelected && uidStr) {
            activeClientBalanceItems.push({
              memberId: uidStr,
              memberName: "",
              phone: "",
              packageName: pkg.name || ptPkgMap.get(pkg.pkgId.toString())?.name || "PT Package",
              packageId: pkg.pkgId.toString(),
              remainingSessions: rem,
              pkgEndDate: cairoDateKey(pkg.pkgEndDate),
              status: pkg.status,
              daysUntilExpiry: daysUntil,
              isLowBalance: isLow,
              isExpiringSoon: isExp,
            });
          }
        }
      }

      // Update grand totals
      totalSessions += sessions;
      totalScanSessions += scanSessions;
      totalDeductionSessions += deductionSessions;
      totalBoughtPackages += boughtPackages;
      totalBoughtRevenue = round2(totalBoughtRevenue + boughtRevenue);
      totalRemainingSessions += coachRemainingSessions;

      coachRows.push({
        coachId: cm.coachDocIdStr,
        coachName: cm.coach.coachName,
        sessions,
        scanSessions,
        deductionSessions,
        boughtPackages,
        boughtRevenue: round2(boughtRevenue),
        activeClients: coachActiveMemberUids.size,
        remainingSessions: coachRemainingSessions,
        lowBalanceClients: coachLowBalanceMemberUids.size,
        expiringSoon: coachExpiringSoonMemberUids.size,
      });

      // 5. Drill-down details for selectedCoach
      if (isSelected) {
        const neededUserIds = new Set<string>();
        for (const item of activeClientBalanceItems) neededUserIds.add(item.memberId);
        for (const sc of coachScans) if (sc.uid) neededUserIds.add(sc.uid.toString());
        for (const d of coachDeductions) if (d.memberId) neededUserIds.add(d.memberId.toString());
        for (const p of coachPayments) if (p.uid) neededUserIds.add(p.uid.toString());

        const users = neededUserIds.size > 0
          ? await User.find({
              _id: { $in: Array.from(neededUserIds).map((id) => new Types.ObjectId(id)) },
            }).select("name phoneNumber").lean()
          : [];
        const userMap = new Map<string, { name: string; phoneNumber: string }>();
        for (const u of users as any[]) {
          userMap.set(u._id.toString(), {
            name: u.name || "",
            phoneNumber: u.phoneNumber || "",
          });
        }

        // Complete active clients
        for (const item of activeClientBalanceItems) {
          const u = userMap.get(item.memberId);
          item.memberName = u?.name || "Unknown";
          item.phone = u?.phoneNumber || "";
        }

        // Delivered sessions (scans + deductions)
        const deliveredSessions: DeliveredSessionItem[] = [];
        for (const { scan, uid } of coachScans) {
          const uidStr = uid?.toString() ?? "";
          const u = userMap.get(uidStr);
          const scanTime = scan.attendanceTime ? new Date(scan.attendanceTime) : new Date();
          deliveredSessions.push({
            id: scan._id ? scan._id.toString() : `${uidStr}-${scanTime.getTime()}`,
            date: scanTime.toISOString(),
            source: "SCAN",
            memberId: uidStr,
            memberName: u?.name || "Unknown",
            phone: u?.phoneNumber || "",
            packageName: ptPkgMap.get(scan.pkgId?.toString())?.name || "PT Session",
          });
        }

        for (const d of coachDeductions) {
          const uidStr = d.memberId ? d.memberId.toString() : "";
          const u = userMap.get(uidStr);
          const sessionDate = d.sessionDate ? new Date(d.sessionDate) : new Date();
          deliveredSessions.push({
            id: (d as any)._id ? (d as any)._id.toString() : "",
            date: sessionDate.toISOString(),
            source: "COACH_DEDUCTION",
            memberId: uidStr,
            memberName: u?.name || "Unknown",
            phone: u?.phoneNumber || "",
            packageName: d.pkgId ? (ptPkgMap.get(d.pkgId.toString())?.name || "PT Session") : "PT Session",
            reason: d.reason,
          });
        }

        deliveredSessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Bought packages
        const payingMemberUids = coachPayments.filter((p) => p.uid).map((p) => p.uid.toString());
        const payingMembers = payingMemberUids.length > 0
          ? await Member.find({
              uid: { $in: payingMemberUids.map((id) => new Types.ObjectId(id)) },
            }).select("uid packages").lean()
          : [];
        const payingMemberMap = new Map((payingMembers as any[]).map((m) => [m.uid.toString(), m]));

        const boughtPackageItems: BoughtPackageItem[] = [];
        for (const payment of coachPayments) {
          const uidStr = payment.uid ? payment.uid.toString() : null;
          const u = uidStr ? userMap.get(uidStr) : null;
          const pkgDoc = payment.pkgId ? ptPkgMap.get(payment.pkgId.toString()) : null;
          const memberDoc = uidStr ? payingMemberMap.get(uidStr) : null;
          const memberPkg = memberDoc && payment.pkgId
            ? memberDoc.packages.find((p: any) => p.pkgId?.toString() === payment.pkgId?.toString())
            : null;

          boughtPackageItems.push({
            paymentId: (payment as any)._id ? (payment as any)._id.toString() : "",
            memberId: uidStr,
            memberName: u?.name || payment.nonMemberName || "Guest",
            phone: u?.phoneNumber || payment.nonMemberPhone || "",
            packageName: pkgDoc?.name || "PT Package",
            packageId: payment.pkgId ? payment.pkgId.toString() : "",
            amount: Number(payment.amount) || 0,
            numberOfSessions: Number(pkgDoc?.numberOfSessions) || 0,
            paymentDate: payment.paymentTime ? new Date(payment.paymentTime).toISOString() : new Date().toISOString(),
            remainingSessions: memberPkg ? (memberPkg.remainingClasses ?? null) : null,
            packageStatus: memberPkg ? (memberPkg.status ?? null) : null,
          });
        }

        boughtPackageItems.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

        selectedCoachDetails = {
          coachId: cm.coachDocIdStr,
          coachName: cm.coach.coachName,
          boughtPackages: boughtPackageItems,
          deliveredSessions,
          activeClients: activeClientBalanceItems,
        };
      }
    }

    // Filter and enrich expiring soon packages
    const expiringPackagesToReturn = isSingleCoachRequest
      ? rawExpiringPackages.filter((item) => item.coachId === params.coachId)
      : rawExpiringPackages;

    const neededExpiringUserIds = new Set<string>();
    for (const item of expiringPackagesToReturn) {
      if (item.memberId) neededExpiringUserIds.add(item.memberId);
    }

    if (neededExpiringUserIds.size > 0) {
      const expiringUsers = await User.find({
        _id: { $in: Array.from(neededExpiringUserIds).map((id) => new Types.ObjectId(id)) },
      }).select("name phoneNumber").lean();
      const expUserMap = new Map<string, { name: string; phoneNumber: string }>();
      for (const u of expiringUsers as any[]) {
        expUserMap.set(u._id.toString(), {
          name: u.name || "",
          phoneNumber: u.phoneNumber || "",
        });
      }
      for (const item of expiringPackagesToReturn) {
        const u = expUserMap.get(item.memberId);
        item.memberName = u?.name || "Unknown";
        item.phone = u?.phoneNumber || "";
      }
    }

    expiringPackagesToReturn.sort(
      (a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.remainingSessions - b.remainingSessions
    );

    // Sort coaches by total sessions delivered desc, then revenue desc
    coachRows.sort((a, b) => b.sessions - a.sessions || b.boughtRevenue - a.boughtRevenue);

    const result: PtAchievementReport = {
      range: {
        startDate: startKey,
        endDate: endKey,
        filterType: params.filterType,
      },
      totals: {
        sessions: totalSessions,
        scanSessions: totalScanSessions,
        deductionSessions: totalDeductionSessions,
        boughtPackages: totalBoughtPackages,
        boughtRevenue: round2(totalBoughtRevenue),
        activeClients: globalActiveMemberIds.size,
        remainingSessions: totalRemainingSessions,
        lowBalanceClients: globalLowBalanceMemberIds.size,
        expiringSoon: globalExpiringSoonMemberIds.size,
      },
      coaches: coachRows,
      expiringSoonPackages: expiringPackagesToReturn,
      ...(selectedCoachDetails ? { selectedCoach: selectedCoachDetails } : {}),
    };

    cache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  }
}
