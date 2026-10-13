import { Types } from "mongoose";
import Payment from "../models/payment";
import Refund from "../models/refund";
import Package from "../models/package";
import Class from "../models/class";
import ScheduledClass from "../models/scheduledClass";
import Coach from "../models/coach";
import Member from "../models/member";
import User from "../models/user";
import Location from "../models/location";
import DeductionLog from "../models/deductionLog";
import NonUserBooking from "../models/nonUserBookings";
import NonUserPackage from "../models/nonUserPackage";
import { NotFoundError } from "../core/ApiError";
import { locationIdScalarQuery } from "../utils/location-scope";
import { isPackageExpired } from "../utils/timezone";
import {
  DROP_IN_METHOD,
  FinanceRange,
  NON_REVENUE_METHODS,
  ONLINE_METHODS,
  SALES_SEGMENTS,
  cairoKey,
  paymentSegment,
  perSessionValue,
  percentChange,
  previousRange,
  rangeBuckets,
  round2,
} from "../utils/finance-range";

/**
 * Read-only finance analytics for the accountant and management dashboards.
 * Every method here only reads data; nothing is created, updated or deleted.
 */

type AnyDoc = Record<string, any>;

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}

function rangeKey(range: FinanceRange): string {
  return `${range.startKey}|${range.endKey}|${range.locationId ?? "all"}`;
}

const idStr = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Types.ObjectId) return value.toString();
  const maybe = value as { _id?: unknown };
  if (maybe._id) return String(maybe._id);
  return String(value);
};

function withLocation(
  query: Record<string, unknown>,
  locationId: string | null,
  field = "locationId",
): Record<string, unknown> {
  if (!locationId) return query;
  return { $and: [query, locationIdScalarQuery(locationId, field)] };
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

interface PackageInfo {
  id: string;
  name: string;
  category: string;
  price: number;
  numberOfSessions: number;
  coachId: string | null;
  locationId: string | null;
}

interface Lookups {
  packages: Map<string, PackageInfo>;
  packagesByName: Map<string, PackageInfo[]>;
  classes: Map<string, { id: string; title: string; category: string; price: number }>;
  locations: Map<string, string>;
  coaches: Map<string, string>;
}

async function loadLookups(): Promise<Lookups> {
  return cached("lookups", async () => {
    const [packages, classes, locations, coaches] = await Promise.all([
      Package.find({})
        .select("name category price numberOfSessions coachId locationId")
        .lean(),
      Class.find({}).select("title category price").lean(),
      Location.find({}).select("branchName").lean(),
      Coach.find({}).select("coachName").lean(),
    ]);

    const packageMap = new Map<string, PackageInfo>();
    const byName = new Map<string, PackageInfo[]>();
    for (const p of packages as AnyDoc[]) {
      const info: PackageInfo = {
        id: idStr(p._id),
        name: p.name,
        category: p.category,
        price: Number(p.price) || 0,
        numberOfSessions: Number(p.numberOfSessions) || 0,
        coachId: p.coachId ? idStr(p.coachId) : null,
        locationId: p.locationId ? idStr(p.locationId) : null,
      };
      packageMap.set(info.id, info);
      const key = String(p.name ?? "").trim().toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), info]);
    }

    return {
      packages: packageMap,
      packagesByName: byName,
      classes: new Map(
        (classes as AnyDoc[]).map((c) => [
          idStr(c._id),
          { id: idStr(c._id), title: c.title, category: c.category, price: Number(c.price) || 0 },
        ]),
      ),
      locations: new Map((locations as AnyDoc[]).map((l) => [idStr(l._id), l.branchName])),
      coaches: new Map((coaches as AnyDoc[]).map((c) => [idStr(c._id), c.coachName])),
    };
  });
}

/**
 * Class bookings store the package *name*, not its id. Resolve by name,
 * preferring a package from the session's branch.
 */
function resolvePackageByName(
  lookups: Lookups,
  name: string,
  locationId: string | null,
): PackageInfo | null {
  const candidates = lookups.packagesByName.get(String(name ?? "").trim().toLowerCase());
  if (!candidates?.length) return null;
  return (
    candidates.find((c) => locationId && c.locationId === locationId) ??
    candidates.find((c) => !c.locationId) ??
    candidates[0]
  );
}

async function loadUsers(ids: Iterable<string>): Promise<Map<string, { name: string; phone: string }>> {
  const unique = [...new Set([...ids].filter((id) => id && Types.ObjectId.isValid(id)))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select("name phoneNumber")
    .lean();
  return new Map(
    (users as AnyDoc[]).map((u) => [idStr(u._id), { name: u.name, phone: u.phoneNumber }]),
  );
}

const branchName = (lookups: Lookups, id: string | null | undefined) =>
  (id && lookups.locations.get(id)) || (id ? "Unknown branch" : "Unassigned");

// ---------------------------------------------------------------------------
// Payments & refunds
// ---------------------------------------------------------------------------

const PAYMENT_FIELDS =
  "uid nonMemberName nonMemberPhone amount paymentMethod paymentTime orderId merchantReferenceId purpose scid pkgId note isRefunded refundReason locationId";

async function fetchPayments(range: FinanceRange, extra: Record<string, unknown> = {}) {
  return (await Payment.find(
    withLocation({ paymentTime: { $gte: range.start, $lt: range.end }, ...extra }, range.locationId),
  )
    .select(PAYMENT_FIELDS)
    .sort({ paymentTime: -1 })
    .lean()) as AnyDoc[];
}

async function fetchRefunds(range: FinanceRange) {
  return (await Refund.find(
    withLocation({ createdAt: { $gte: range.start, $lt: range.end } }, range.locationId),
  )
    .sort({ createdAt: -1 })
    .lean()) as AnyDoc[];
}

const isRevenue = (p: AnyDoc) => !NON_REVENUE_METHODS.includes(p.paymentMethod);

interface MoneySummary {
  gross: number;
  refunds: number;
  cashOuts: number;
  net: number;
  netCash: number;
  transactions: number;
  avgTicket: number;
  payingCustomers: number;
  refundCount: number;
  cashOutCount: number;
  deductedCount: number;
}

function summarizeMoney(payments: AnyDoc[], refunds: AnyDoc[]): MoneySummary {
  const revenue = payments.filter(isRevenue);
  const gross = revenue.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const refundDocs = refunds.filter((r) => r.type === "REFUND");
  const cashOutDocs = refunds.filter((r) => r.type === "CASHOUT");
  const refundTotal = refundDocs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const cashOutTotal = cashOutDocs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const customers = new Set(
    revenue.map((p) => idStr(p.uid) || `${p.nonMemberPhone ?? ""}|${p.nonMemberName ?? ""}`),
  );
  return {
    gross: round2(gross),
    refunds: round2(refundTotal),
    cashOuts: round2(cashOutTotal),
    net: round2(gross - refundTotal),
    netCash: round2(gross - refundTotal - cashOutTotal),
    transactions: revenue.length,
    avgTicket: revenue.length ? round2(gross / revenue.length) : 0,
    payingCustomers: customers.size,
    refundCount: refundDocs.length,
    cashOutCount: cashOutDocs.length,
    deductedCount: payments.length - revenue.length,
  };
}

function withDeltas(current: MoneySummary, previous: MoneySummary) {
  const keys = Object.keys(current) as (keyof MoneySummary)[];
  const deltas: Record<string, number | null> = {};
  for (const key of keys) deltas[key] = percentChange(current[key], previous[key]);
  return { current, previous, deltas };
}

async function loadScheduledClassCids(ids: string[]): Promise<Map<string, AnyDoc>> {
  const valid = [...new Set(ids.filter((id) => id && Types.ObjectId.isValid(id)))];
  if (!valid.length) return new Map();
  const docs = await ScheduledClass.find({ _id: { $in: valid } })
    .select("cid startTime coachId locationId")
    .lean();
  return new Map((docs as AnyDoc[]).map((d) => [idStr(d._id), d]));
}

function paymentItemName(p: AnyDoc, lookups: Lookups, scheduled: Map<string, AnyDoc>): string {
  if (p.pkgId) {
    const pkg = lookups.packages.get(idStr(p.pkgId));
    if (pkg) return pkg.name;
  }
  if (p.scid) {
    const sc = scheduled.get(idStr(p.scid));
    const cls = sc ? lookups.classes.get(idStr(sc.cid)) : undefined;
    if (cls) return cls.title;
  }
  const labels: Record<string, string> = {
    DROPIN: "Drop-in",
    PACKAGE: "Package",
    WALKIN: "Walk-in",
    NON_USER_BOOKING: "Non-member drop-in",
    NON_USER_PACKAGE: "Non-member package",
    OTHER: "Other",
  };
  return p.note?.trim() || labels[p.purpose] || p.purpose;
}

function listPrice(p: AnyDoc, lookups: Lookups, scheduled: Map<string, AnyDoc>): number | null {
  if (p.pkgId) return lookups.packages.get(idStr(p.pkgId))?.price ?? null;
  if (p.scid) {
    const sc = scheduled.get(idStr(p.scid));
    const cls = sc ? lookups.classes.get(idStr(sc.cid)) : undefined;
    return cls?.price ?? null;
  }
  return null;
}

function paginate<T>(rows: T[], page: number, limit: number) {
  const safeLimit = limit <= 0 ? rows.length || 1 : limit;
  const totalPages = Math.max(1, Math.ceil(rows.length / safeLimit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    rows: rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    total: rows.length,
    page: safePage,
    limit: safeLimit,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// Sessions (classes + PT)
// ---------------------------------------------------------------------------

interface PtSession {
  date: Date;
  memberId: string;
  pkgId: string;
  coachId: string | null;
  locationId: string | null;
  source: "SCAN" | "COACH_DEDUCTION";
  reason?: string;
}

async function loadPtSessions(range: FinanceRange, lookups: Lookups): Promise<PtSession[]> {
  const ptPackageIds = new Set(
    [...lookups.packages.values()]
      .filter((p) => p.category === "PERSONAL_TRAINING")
      .map((p) => p.id),
  );

  const [members, logs] = await Promise.all([
    Member.find({ ptAttendance: { $elemMatch: { attendanceTime: { $gte: range.start, $lt: range.end } } } })
      .select("uid ptAttendance packages.pkgId packages.locationId")
      .lean(),
    DeductionLog.find({ sessionDate: { $gte: range.start, $lt: range.end } }).lean(),
  ]);

  const sessions: PtSession[] = [];
  for (const m of members as AnyDoc[]) {
    for (const att of m.ptAttendance ?? []) {
      const time = new Date(att.attendanceTime);
      if (time < range.start || time >= range.end) continue;
      const pkgId = idStr(att.pkgId);
      const pkg = lookups.packages.get(pkgId);
      if (!ptPackageIds.has(pkgId) && !pkg?.coachId) continue;
      const memberPkg = (m.packages ?? []).find((mp: AnyDoc) => idStr(mp.pkgId) === pkgId);
      sessions.push({
        date: time,
        memberId: idStr(m.uid),
        pkgId,
        coachId: pkg?.coachId ?? null,
        locationId: (memberPkg?.locationId && idStr(memberPkg.locationId)) || pkg?.locationId || null,
        source: "SCAN",
      });
    }
  }

  for (const log of logs as AnyDoc[]) {
    const pkgId = idStr(log.pkgId);
    const pkg = lookups.packages.get(pkgId);
    sessions.push({
      date: new Date(log.sessionDate),
      memberId: idStr(log.memberId),
      pkgId,
      coachId: idStr(log.coachId) || pkg?.coachId || null,
      locationId: pkg?.locationId ?? null,
      source: "COACH_DEDUCTION",
      reason: log.reason,
    });
  }

  return sessions
    .filter((s) => !range.locationId || !s.locationId || s.locationId === range.locationId)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

interface ClassSessionInfo {
  id: string;
  classTitle: string;
  category: string;
  locationId: string | null;
  start: Date;
  hours: number;
  coachIds: string[];
  capacity: number;
  bookings: { uid: string; method: string; attended: boolean }[];
  nonMember: { name: string; phone: string; attended: boolean }[];
  dropInRevenue: number;
}

async function loadClassSessions(
  range: FinanceRange,
  lookups: Lookups,
  coachId?: string,
): Promise<ClassSessionInfo[]> {
  const query: Record<string, unknown> = { startTime: { $gte: range.start, $lt: range.end } };
  if (coachId) query.coachId = new Types.ObjectId(coachId);
  const docs = (await ScheduledClass.find(withLocation(query, range.locationId))
    .select("cid locationId startTime endTime availableSlots bookedMembers coachId scans")
    .sort({ startTime: -1 })
    .lean()) as AnyDoc[];
  if (!docs.length) return [];

  const ids = docs.map((d) => d._id);
  const [nonUsers, dropInPayments] = await Promise.all([
    NonUserBooking.find({ scid: { $in: ids }, status: { $ne: "CANCELLED" } })
      .select("scid name phoneNumber status")
      .lean(),
    Payment.find({ scid: { $in: ids }, paymentMethod: { $nin: NON_REVENUE_METHODS } })
      .select("scid amount")
      .lean(),
  ]);

  const nonUserBySession = new Map<string, AnyDoc[]>();
  for (const nb of nonUsers as AnyDoc[]) {
    const key = idStr(nb.scid);
    nonUserBySession.set(key, [...(nonUserBySession.get(key) ?? []), nb]);
  }
  const dropInBySession = new Map<string, number>();
  for (const p of dropInPayments as AnyDoc[]) {
    const key = idStr(p.scid);
    dropInBySession.set(key, (dropInBySession.get(key) ?? 0) + (Number(p.amount) || 0));
  }

  return docs.map((d) => {
    const id = idStr(d._id);
    const cls = lookups.classes.get(idStr(d.cid));
    const attendedUids = new Set(
      (d.scans ?? []).filter((s: AnyDoc) => s.status !== false).map((s: AnyDoc) => idStr(s.uid)),
    );
    const seen = new Set<string>();
    const bookings = (d.bookedMembers ?? [])
      .filter((b: AnyDoc) => {
        const uid = idStr(b.uid);
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      })
      .map((b: AnyDoc) => ({
        uid: idStr(b.uid),
        method: b.method,
        attended: attendedUids.has(idStr(b.uid)),
      }));
    const nonMember = (nonUserBySession.get(id) ?? []).map((nb) => ({
      name: nb.name,
      phone: nb.phoneNumber,
      attended: nb.status === "ATTENDED" || nb.status === "PAID" || nb.status === "FOC",
    }));
    const start = new Date(d.startTime);
    const end = new Date(d.endTime);
    const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
    return {
      id,
      classTitle: cls?.title ?? "Unknown class",
      category: cls?.category ?? "UNCATEGORIZED",
      locationId: d.locationId ? idStr(d.locationId) : null,
      start,
      hours: round2(hours),
      coachIds: (d.coachId ?? []).map(idStr).filter(Boolean),
      capacity: Math.max(0, (Number(d.availableSlots) || 0) + bookings.length + nonMember.length),
      bookings,
      nonMember,
      dropInRevenue: dropInBySession.get(id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class FinanceService {
  /** Headline numbers, trend and breakdowns. */
  static async overview(range: FinanceRange) {
    return cached(`overview|${rangeKey(range)}`, async () => {
      const prev = previousRange(range);
      const [lookups, payments, refunds, prevPayments, prevRefunds] = await Promise.all([
        loadLookups(),
        fetchPayments(range),
        fetchRefunds(range),
        fetchPayments(prev),
        fetchRefunds(prev),
      ]);

      const buckets = rangeBuckets(range);
      const prevBuckets = rangeBuckets(prev);
      const trendMap = new Map(buckets.map((k) => [k, { gross: 0, refunds: 0 }]));
      const prevTrend = new Map(prevBuckets.map((k) => [k, 0]));

      for (const p of payments.filter(isRevenue)) {
        const row = trendMap.get(cairoKey(new Date(p.paymentTime), range.granularity));
        if (row) row.gross += Number(p.amount) || 0;
      }
      for (const r of refunds.filter((x) => x.type === "REFUND")) {
        const row = trendMap.get(cairoKey(new Date(r.createdAt), range.granularity));
        if (row) row.refunds += Number(r.amount) || 0;
      }
      for (const p of prevPayments.filter(isRevenue)) {
        const key = cairoKey(new Date(p.paymentTime), range.granularity);
        if (prevTrend.has(key)) prevTrend.set(key, prevTrend.get(key)! + (Number(p.amount) || 0));
      }
      for (const r of prevRefunds.filter((x) => x.type === "REFUND")) {
        const key = cairoKey(new Date(r.createdAt), range.granularity);
        if (prevTrend.has(key)) prevTrend.set(key, prevTrend.get(key)! - (Number(r.amount) || 0));
      }

      const trend = buckets.map((key, i) => {
        const row = trendMap.get(key)!;
        const prevKey = prevBuckets[i];
        return {
          bucket: key,
          gross: round2(row.gross),
          refunds: round2(row.refunds),
          net: round2(row.gross - row.refunds),
          previousNet: prevKey !== undefined ? round2(prevTrend.get(prevKey) ?? 0) : null,
        };
      });

      const group = <K extends string>(rows: AnyDoc[], keyFn: (p: AnyDoc) => K) => {
        const map = new Map<K, { amount: number; count: number }>();
        for (const p of rows) {
          const key = keyFn(p);
          const row = map.get(key) ?? { amount: 0, count: 0 };
          row.amount += Number(p.amount) || 0;
          row.count += 1;
          map.set(key, row);
        }
        return [...map.entries()]
          .map(([key, v]) => ({ key, amount: round2(v.amount), count: v.count }))
          .sort((a, b) => b.amount - a.amount);
      };

      const revenue = payments.filter(isRevenue);
      const refundsByBranch = new Map<string, number>();
      for (const r of refunds.filter((x) => x.type === "REFUND")) {
        const key = idStr(r.locationId);
        refundsByBranch.set(key, (refundsByBranch.get(key) ?? 0) + (Number(r.amount) || 0));
      }

      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        previousRange: { startDate: prev.startKey, endDate: prev.endKey },
        summary: withDeltas(summarizeMoney(payments, refunds), summarizeMoney(prevPayments, prevRefunds)),
        trend,
        byBranch: group(revenue, (p) => idStr(p.locationId)).map((row) => ({
          locationId: row.key,
          branchName: branchName(lookups, row.key),
          gross: row.amount,
          refunds: round2(refundsByBranch.get(row.key) ?? 0),
          net: round2(row.amount - (refundsByBranch.get(row.key) ?? 0)),
          count: row.count,
        })),
        byMethod: group(revenue, (p) => p.paymentMethod as string).map((row) => ({
          method: row.key,
          amount: row.amount,
          count: row.count,
        })),
        bySegment: group(revenue, (p) =>
          paymentSegment(p.purpose, lookups.packages.get(idStr(p.pkgId))?.category),
        ).map((row) => ({ segment: row.key, amount: row.amount, count: row.count })),
      };
    });
  }

  /** Revenue by package category / drop-in type with the detailed payments. */
  static async sales(
    range: FinanceRange,
    options: { segment?: string; page: number; limit: number; search?: string },
  ) {
    const base = await cached(`sales|${rangeKey(range)}`, async () => {
      const prev = previousRange(range);
      const [lookups, payments, prevPayments] = await Promise.all([
        loadLookups(),
        fetchPayments(range, { paymentMethod: { $nin: NON_REVENUE_METHODS } }),
        fetchPayments(prev, { paymentMethod: { $nin: NON_REVENUE_METHODS } }),
      ]);
      const scheduled = await loadScheduledClassCids(payments.map((p) => idStr(p.scid)));
      const users = await loadUsers(payments.map((p) => idStr(p.uid)));

      const rows = payments.map((p) => {
        const pkg = p.pkgId ? lookups.packages.get(idStr(p.pkgId)) : undefined;
        const user = users.get(idStr(p.uid));
        const price = listPrice(p, lookups, scheduled);
        const amount = Number(p.amount) || 0;
        return {
          id: idStr(p._id),
          time: p.paymentTime,
          bucket: cairoKey(new Date(p.paymentTime), range.granularity),
          customer: user?.name || p.nonMemberName || "Walk-in customer",
          phone: user?.phone || p.nonMemberPhone || "",
          memberId: idStr(p.uid) || null,
          item: paymentItemName(p, lookups, scheduled),
          segment: paymentSegment(p.purpose, pkg?.category),
          purpose: p.purpose,
          method: p.paymentMethod,
          amount: round2(amount),
          listPrice: price,
          discount: price !== null && price > amount ? round2(price - amount) : 0,
          branchId: idStr(p.locationId),
          branch: branchName(lookups, idStr(p.locationId)),
          isRefunded: Boolean(p.isRefunded),
          reference: p.merchantReferenceId || p.orderId || "",
        };
      });

      const prevBySegment = new Map<string, number>();
      for (const p of prevPayments) {
        const seg = paymentSegment(p.purpose, lookups.packages.get(idStr(p.pkgId))?.category);
        prevBySegment.set(seg, (prevBySegment.get(seg) ?? 0) + (Number(p.amount) || 0));
      }
      return { rows, prevBySegment };
    });

    const { rows, prevBySegment } = base;
    const segments = SALES_SEGMENTS.map((segment) => {
      const segRows = rows.filter((r) => r.segment === segment);
      const amount = segRows.reduce((s, r) => s + r.amount, 0);
      const prevAmount = prevBySegment.get(segment) ?? 0;
      return {
        segment,
        amount: round2(amount),
        count: segRows.length,
        previousAmount: round2(prevAmount),
        change: percentChange(amount, prevAmount),
      };
    }).filter((s) => s.count > 0 || s.previousAmount > 0);

    const selected =
      options.segment && options.segment !== "ALL"
        ? rows.filter((r) => r.segment === options.segment)
        : rows;

    const trendMap = new Map(rangeBuckets(range).map((k) => [k, { amount: 0, count: 0 }]));
    const items = new Map<string, { name: string; amount: number; count: number; listPrice: number | null; discount: number }>();
    const methods = new Map<string, { amount: number; count: number }>();
    let discountTotal = 0;
    let discountedCount = 0;
    let listTotal = 0;

    for (const r of selected) {
      const t = trendMap.get(r.bucket);
      if (t) {
        t.amount += r.amount;
        t.count += 1;
      }
      const item = items.get(r.item) ?? { name: r.item, amount: 0, count: 0, listPrice: r.listPrice, discount: 0 };
      item.amount += r.amount;
      item.count += 1;
      item.discount += r.discount;
      items.set(r.item, item);
      const m = methods.get(r.method) ?? { amount: 0, count: 0 };
      m.amount += r.amount;
      m.count += 1;
      methods.set(r.method, m);
      if (r.listPrice !== null) listTotal += r.listPrice;
      if (r.discount > 0) {
        discountTotal += r.discount;
        discountedCount += 1;
      }
    }

    const search = options.search?.trim().toLowerCase();
    const filtered = search
      ? selected.filter((r) =>
          [r.customer, r.phone, r.item, r.reference, r.branch].some((v) =>
            String(v ?? "").toLowerCase().includes(search),
          ),
        )
      : selected;

    const selectedTotal = selected.reduce((s, r) => s + r.amount, 0);
    return {
      range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
      segment: options.segment || "ALL",
      segments,
      totals: {
        amount: round2(selectedTotal),
        count: selected.length,
        avgTicket: selected.length ? round2(selectedTotal / selected.length) : 0,
        discountTotal: round2(discountTotal),
        discountedCount,
        discountRate: listTotal ? round2((discountTotal / listTotal) * 100) : 0,
        uniqueCustomers: new Set(selected.map((r) => r.memberId || `${r.phone}|${r.customer}`)).size,
      },
      trend: [...trendMap.entries()].map(([bucket, v]) => ({
        bucket,
        amount: round2(v.amount),
        count: v.count,
      })),
      topItems: [...items.values()]
        .map((i) => ({
          ...i,
          amount: round2(i.amount),
          discount: round2(i.discount),
          avgPaid: i.count ? round2(i.amount / i.count) : 0,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15),
      byMethod: [...methods.entries()]
        .map(([method, v]) => ({ method, amount: round2(v.amount), count: v.count }))
        .sort((a, b) => b.amount - a.amount),
      payments: paginate(
        filtered.map(({ bucket: _bucket, ...rest }) => rest),
        options.page,
        options.limit,
      ),
    };
  }

  /** Hours, sessions, attendance and revenue per coach. */
  static async coachHours(range: FinanceRange) {
    return cached(`coachHours|${rangeKey(range)}`, async () => {
      const lookups = await loadLookups();
      const [sessions, ptSessions, ptPayments] = await Promise.all([
        loadClassSessions(range, lookups),
        loadPtSessions(range, lookups),
        fetchPayments(range, {
          paymentMethod: { $nin: NON_REVENUE_METHODS },
          purpose: { $in: ["PACKAGE", "NON_USER_PACKAGE"] },
        }),
      ]);

      type Row = {
        coachId: string;
        name: string;
        sessions: number;
        hours: number;
        hoursByCategory: Record<string, number>;
        sessionsByCategory: Record<string, number>;
        capacity: number;
        booked: number;
        attended: number;
        packageUses: number;
        attendedPackageUses: number;
        dropIns: number;
        dropInRevenue: number;
        packageValue: number;
        ptSessions: number;
        ptRevenue: number;
        members: Set<string>;
      };
      const rows = new Map<string, Row>();
      const rowFor = (coachId: string): Row => {
        let row = rows.get(coachId);
        if (!row) {
          row = {
            coachId,
            name: lookups.coaches.get(coachId) ?? "Unknown coach",
            sessions: 0,
            hours: 0,
            hoursByCategory: {},
            sessionsByCategory: {},
            capacity: 0,
            booked: 0,
            attended: 0,
            packageUses: 0,
            attendedPackageUses: 0,
            dropIns: 0,
            dropInRevenue: 0,
            packageValue: 0,
            ptSessions: 0,
            ptRevenue: 0,
            members: new Set(),
          };
          rows.set(coachId, row);
        }
        return row;
      };

      const buckets = rangeBuckets(range);
      const trend = new Map(buckets.map((k) => [k, {} as Record<string, number>]));
      const categories = new Set<string>();

      for (const s of sessions) {
        const coachCount = s.coachIds.length || 1;
        const booked = s.bookings.length + s.nonMember.length;
        const attended =
          s.bookings.filter((b) => b.attended).length + s.nonMember.filter((n) => n.attended).length;
        const packageBookings = s.bookings.filter((b) => b.method !== DROP_IN_METHOD);
        const attendedPackage = packageBookings.filter((b) => b.attended);
        const packageValue = attendedPackage.reduce((sum, b) => {
          const pkg = resolvePackageByName(lookups, b.method, s.locationId);
          return sum + (perSessionValue(pkg) ?? 0);
        }, 0);
        const dropIns =
          s.bookings.filter((b) => b.method === DROP_IN_METHOD).length + s.nonMember.length;

        categories.add(s.category);
        const t = trend.get(cairoKey(s.start, range.granularity));
        if (t) t[s.category] = round2((t[s.category] ?? 0) + s.hours * Math.max(1, s.coachIds.length));

        for (const coachId of s.coachIds) {
          const row = rowFor(coachId);
          row.sessions += 1;
          row.hours += s.hours;
          row.hoursByCategory[s.category] = (row.hoursByCategory[s.category] ?? 0) + s.hours;
          row.sessionsByCategory[s.category] = (row.sessionsByCategory[s.category] ?? 0) + 1;
          row.capacity += s.capacity;
          row.booked += booked;
          row.attended += attended;
          row.packageUses += packageBookings.length;
          row.attendedPackageUses += attendedPackage.length;
          row.dropIns += dropIns;
          row.dropInRevenue += s.dropInRevenue / coachCount;
          row.packageValue += packageValue / coachCount;
          s.bookings.forEach((b) => row.members.add(b.uid));
        }
      }

      for (const pt of ptSessions) {
        if (!pt.coachId) continue;
        const row = rowFor(pt.coachId);
        row.ptSessions += 1;
        row.packageUses += 1;
        row.attendedPackageUses += 1;
        row.packageValue += perSessionValue(lookups.packages.get(pt.pkgId)) ?? 0;
        row.members.add(pt.memberId);
      }

      for (const p of ptPayments) {
        const pkg = lookups.packages.get(idStr(p.pkgId));
        if (!pkg?.coachId) continue;
        rowFor(pkg.coachId).ptRevenue += Number(p.amount) || 0;
      }

      const coaches = [...rows.values()]
        .map(({ members, ...row }) => ({
          ...row,
          hours: round2(row.hours),
          hoursByCategory: Object.fromEntries(
            Object.entries(row.hoursByCategory).map(([k, v]) => [k, round2(v)]),
          ),
          dropInRevenue: round2(row.dropInRevenue),
          packageValue: round2(row.packageValue),
          ptRevenue: round2(row.ptRevenue),
          attributedRevenue: round2(row.dropInRevenue + row.packageValue + row.ptRevenue),
          uniqueMembers: members.size,
          fillRate: row.capacity ? round2((row.booked / row.capacity) * 100) : null,
          attendanceRate: row.booked ? round2((row.attended / row.booked) * 100) : null,
        }))
        .sort((a, b) => b.hours - a.hours || b.ptSessions - a.ptSessions);

      const categoryTotals = [...categories].map((category) => ({
        category,
        hours: round2(sessions.filter((s) => s.category === category).reduce((sum, s) => sum + s.hours * Math.max(1, s.coachIds.length), 0)),
        sessions: sessions.filter((s) => s.category === category).length,
      })).sort((a, b) => b.hours - a.hours);

      const byClass = new Map<string, { classTitle: string; category: string; sessions: number; hours: number; booked: number; attended: number; capacity: number; dropInRevenue: number }>();
      for (const s of sessions) {
        const row = byClass.get(s.classTitle) ?? { classTitle: s.classTitle, category: s.category, sessions: 0, hours: 0, booked: 0, attended: 0, capacity: 0, dropInRevenue: 0 };
        row.sessions += 1;
        row.hours += s.hours;
        row.booked += s.bookings.length + s.nonMember.length;
        row.attended += s.bookings.filter((b) => b.attended).length + s.nonMember.filter((n) => n.attended).length;
        row.capacity += s.capacity;
        row.dropInRevenue += s.dropInRevenue;
        byClass.set(s.classTitle, row);
      }

      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        totals: {
          sessions: sessions.length,
          hours: round2(sessions.reduce((sum, s) => sum + s.hours * Math.max(1, s.coachIds.length), 0)),
          ptSessions: ptSessions.length,
          activeCoaches: coaches.length,
          booked: sessions.reduce((sum, s) => sum + s.bookings.length + s.nonMember.length, 0),
          attended: sessions.reduce(
            (sum, s) => sum + s.bookings.filter((b) => b.attended).length + s.nonMember.filter((n) => n.attended).length,
            0,
          ),
          unassignedSessions: sessions.filter((s) => !s.coachIds.length).length,
        },
        categories: categoryTotals,
        coaches,
        byClass: [...byClass.values()]
          .map((c) => ({
            ...c,
            hours: round2(c.hours),
            dropInRevenue: round2(c.dropInRevenue),
            fillRate: c.capacity ? round2((c.booked / c.capacity) * 100) : null,
            attendanceRate: c.booked ? round2((c.attended / c.booked) * 100) : null,
          }))
          .sort((a, b) => b.sessions - a.sessions),
        trend: buckets.map((bucket) => ({ bucket, ...trend.get(bucket) })),
      };
    });
  }

  /** Every package use in a coach's sessions, with per-package and per-member summaries. */
  static async coachPackageUsage(range: FinanceRange, coachId: string) {
    const coach = await Coach.findById(coachId).select("coachName").lean();
    if (!coach) throw new NotFoundError("COACH_NOT_FOUND", "Coach not found");

    return cached(`coachUsage|${coachId}|${rangeKey(range)}`, async () => {
      const lookups = await loadLookups();
      const [sessions, allPt] = await Promise.all([
        loadClassSessions(range, lookups, coachId),
        loadPtSessions(range, lookups),
      ]);
      const pt = allPt.filter((s) => s.coachId === coachId);

      const users = await loadUsers([
        ...sessions.flatMap((s) => s.bookings.map((b) => b.uid)),
        ...pt.map((s) => s.memberId),
      ]);

      type Entry = {
        id: string;
        date: Date;
        type: "CLASS" | "PT";
        source: string;
        sessionId: string | null;
        classTitle: string;
        category: string;
        memberId: string | null;
        memberName: string;
        phone: string;
        packageName: string;
        packageCategory: string | null;
        isDropIn: boolean;
        attended: boolean;
        sessionValue: number | null;
        branch: string;
      };

      const entries: Entry[] = [];
      for (const s of sessions) {
        for (const b of s.bookings) {
          const isDropIn = b.method === DROP_IN_METHOD;
          const pkg = isDropIn ? null : resolvePackageByName(lookups, b.method, s.locationId);
          const user = users.get(b.uid);
          entries.push({
            id: `${s.id}:${b.uid}`,
            date: s.start,
            type: "CLASS",
            source: "Class booking",
            sessionId: s.id,
            classTitle: s.classTitle,
            category: s.category,
            memberId: b.uid,
            memberName: user?.name ?? "Unknown member",
            phone: user?.phone ?? "",
            packageName: isDropIn ? "Drop-in" : b.method,
            packageCategory: pkg?.category ?? null,
            isDropIn,
            attended: b.attended,
            sessionValue: isDropIn ? null : perSessionValue(pkg),
            branch: branchName(lookups, s.locationId),
          });
        }
        s.nonMember.forEach((n, i) => {
          entries.push({
            id: `${s.id}:nonmember:${i}`,
            date: s.start,
            type: "CLASS",
            source: "Non-member booking",
            sessionId: s.id,
            classTitle: s.classTitle,
            category: s.category,
            memberId: null,
            memberName: n.name,
            phone: n.phone,
            packageName: "Non-member drop-in",
            packageCategory: null,
            isDropIn: true,
            attended: n.attended,
            sessionValue: null,
            branch: branchName(lookups, s.locationId),
          });
        });
      }
      pt.forEach((s, i) => {
        const pkg = lookups.packages.get(s.pkgId);
        const user = users.get(s.memberId);
        entries.push({
          id: `pt:${i}:${s.memberId}:${s.date.getTime()}`,
          date: s.date,
          type: "PT",
          source: s.source === "SCAN" ? "PT check-in" : "Coach deduction",
          sessionId: null,
          classTitle: "Personal training",
          category: "PERSONAL_TRAINING",
          memberId: s.memberId,
          memberName: user?.name ?? "Unknown member",
          phone: user?.phone ?? "",
          packageName: pkg?.name ?? "Unknown package",
          packageCategory: pkg?.category ?? "PERSONAL_TRAINING",
          isDropIn: false,
          attended: true,
          sessionValue: perSessionValue(pkg),
          branch: branchName(lookups, s.locationId),
        });
      });
      entries.sort((a, b) => b.date.getTime() - a.date.getTime());

      const packageEntries = entries.filter((e) => !e.isDropIn);
      const byPackage = new Map<string, { packageName: string; category: string | null; uses: number; attended: number; members: Set<string>; value: number }>();
      for (const e of packageEntries) {
        const row = byPackage.get(e.packageName) ?? { packageName: e.packageName, category: e.packageCategory, uses: 0, attended: 0, members: new Set<string>(), value: 0 };
        row.uses += 1;
        if (e.attended) {
          row.attended += 1;
          row.value += e.sessionValue ?? 0;
        }
        if (e.memberId) row.members.add(e.memberId);
        byPackage.set(e.packageName, row);
      }

      const byMember = new Map<string, { memberId: string | null; memberName: string; phone: string; uses: number; attended: number; dropIns: number; packages: Set<string> }>();
      for (const e of entries) {
        const key = e.memberId ?? `nonmember:${e.phone}:${e.memberName}`;
        const row = byMember.get(key) ?? { memberId: e.memberId, memberName: e.memberName, phone: e.phone, uses: 0, attended: 0, dropIns: 0, packages: new Set<string>() };
        if (e.isDropIn) {
          row.dropIns += 1;
        } else {
          row.uses += 1;
          row.packages.add(e.packageName);
          if (e.attended) row.attended += 1;
        }
        byMember.set(key, row);
      }

      const attendedPackage = packageEntries.filter((e) => e.attended);
      return {
        coach: { id: coachId, name: (coach as AnyDoc).coachName },
        range: { startDate: range.startKey, endDate: range.endKey },
        summary: {
          classSessions: sessions.length,
          ptSessions: pt.length,
          totalSessions: sessions.length + pt.length,
          classHours: round2(sessions.reduce((sum, s) => sum + s.hours, 0)),
          totalBookings: entries.length,
          packageUses: packageEntries.length,
          attendedPackageUses: attendedPackage.length,
          dropIns: entries.filter((e) => e.isDropIn).length,
          attendedDropIns: entries.filter((e) => e.isDropIn && e.attended).length,
          uniqueMembers: new Set(entries.map((e) => e.memberId ?? `${e.phone}|${e.memberName}`)).size,
          uniquePackages: byPackage.size,
          estimatedValue: round2(attendedPackage.reduce((sum, e) => sum + (e.sessionValue ?? 0), 0)),
        },
        byPackage: [...byPackage.values()]
          .map(({ members, ...row }) => ({ ...row, members: members.size, value: round2(row.value) }))
          .sort((a, b) => b.uses - a.uses),
        byMember: [...byMember.values()]
          .map(({ packages, ...row }) => ({ ...row, packages: [...packages] }))
          .sort((a, b) => b.uses + b.dropIns - (a.uses + a.dropIns)),
        entries,
      };
    });
  }

  /** Personal training: sessions, clients, balances, revenue and renewals. */
  static async ptAnalytics(range: FinanceRange) {
    return cached(`pt|${rangeKey(range)}`, async () => {
      const lookups = await loadLookups();
      const ptPackages = [...lookups.packages.values()].filter((p) => p.category === "PERSONAL_TRAINING");
      const ptIds = ptPackages.map((p) => p.id);
      const ptIdSet = new Set(ptIds);

      const [sessions, members, payments] = await Promise.all([
        loadPtSessions(range, lookups),
        ptIds.length
          ? Member.find({ "packages.pkgId": { $in: ptIds.map((id) => new Types.ObjectId(id)) } })
              .select("uid packages")
              .lean()
          : Promise.resolve([]),
        ptIds.length
          ? fetchPayments(range, {
              pkgId: { $in: ptIds.map((id) => new Types.ObjectId(id)) },
              paymentMethod: { $nin: NON_REVENUE_METHODS },
            })
          : Promise.resolve([] as AnyDoc[]),
      ]);

      // Renewal = the member had paid for a PT package before this payment.
      const payerIds = [...new Set(payments.map((p) => idStr(p.uid)).filter(Boolean))];
      const earliest = payerIds.length
        ? await Payment.aggregate([
            {
              $match: {
                uid: { $in: payerIds.map((id) => new Types.ObjectId(id)) },
                pkgId: { $in: ptIds.map((id) => new Types.ObjectId(id)) },
                paymentMethod: { $nin: NON_REVENUE_METHODS },
              },
            },
            { $group: { _id: "$uid", first: { $min: "$paymentTime" } } },
          ])
        : [];
      const firstPayment = new Map(earliest.map((e: AnyDoc) => [idStr(e._id), new Date(e.first)]));

      type CoachRow = {
        coachId: string;
        name: string;
        sessions: number;
        scanSessions: number;
        deductionSessions: number;
        clients: Set<string>;
        remainingSessions: number;
        lowBalanceClients: number;
        expiringSoon: number;
        revenue: number;
        sales: number;
        newSales: number;
        renewals: number;
      };
      const rows = new Map<string, CoachRow>();
      const rowFor = (coachId: string | null): CoachRow => {
        const key = coachId ?? "unassigned";
        let row = rows.get(key);
        if (!row) {
          row = {
            coachId: key,
            name: coachId ? lookups.coaches.get(coachId) ?? "Unknown coach" : "No coach assigned",
            sessions: 0,
            scanSessions: 0,
            deductionSessions: 0,
            clients: new Set(),
            remainingSessions: 0,
            lowBalanceClients: 0,
            expiringSoon: 0,
            revenue: 0,
            sales: 0,
            newSales: 0,
            renewals: 0,
          };
          rows.set(key, row);
        }
        return row;
      };

      const buckets = rangeBuckets(range);
      const trend = new Map(buckets.map((k) => [k, { sessions: 0, revenue: 0 }]));

      for (const s of sessions) {
        const row = rowFor(s.coachId);
        row.sessions += 1;
        if (s.source === "SCAN") row.scanSessions += 1;
        else row.deductionSessions += 1;
        const t = trend.get(cairoKey(s.date, range.granularity));
        if (t) t.sessions += 1;
      }

      let newSales = 0;
      let renewals = 0;
      for (const p of payments) {
        const pkg = lookups.packages.get(idStr(p.pkgId));
        const row = rowFor(pkg?.coachId ?? null);
        const amount = Number(p.amount) || 0;
        row.revenue += amount;
        row.sales += 1;
        const first = firstPayment.get(idStr(p.uid));
        const isRenewal = Boolean(first && first < new Date(p.paymentTime));
        if (isRenewal) {
          row.renewals += 1;
          renewals += 1;
        } else {
          row.newSales += 1;
          newSales += 1;
        }
        const t = trend.get(cairoKey(new Date(p.paymentTime), range.granularity));
        if (t) t.revenue += amount;
      }

      const now = new Date();
      const soon = new Date(now.getTime() + 7 * DAY_MS);
      const alerts: AnyDoc[] = [];
      const memberUsers = await loadUsers((members as AnyDoc[]).map((m) => idStr(m.uid)));
      let activePackages = 0;
      let remainingTotal = 0;
      let remainingValue = 0;

      for (const m of members as AnyDoc[]) {
        for (const mp of m.packages ?? []) {
          const pkgId = idStr(mp.pkgId);
          if (!ptIdSet.has(pkgId)) continue;
          if (!["ACTIVE", "FROZEN"].includes(mp.status)) continue;
          const end = new Date(mp.pkgEndDate);
          if (end < now) continue;
          const pkg = lookups.packages.get(pkgId);
          const loc = (mp.locationId && idStr(mp.locationId)) || pkg?.locationId || null;
          if (range.locationId && loc && loc !== range.locationId) continue;

          activePackages += 1;
          const remaining = Number(mp.remainingClasses) || 0;
          const row = rowFor(pkg?.coachId ?? null);
          row.clients.add(idStr(m.uid));
          row.remainingSessions += remaining;
          remainingTotal += remaining;
          remainingValue += remaining * (perSessionValue(pkg) ?? 0);

          const low = remaining <= 2;
          const expiring = end <= soon;
          if (low) row.lowBalanceClients += 1;
          if (expiring) row.expiringSoon += 1;
          if (low || expiring) {
            const user = memberUsers.get(idStr(m.uid));
            alerts.push({
              memberId: idStr(m.uid),
              memberName: user?.name ?? "Unknown member",
              phone: user?.phone ?? "",
              coach: row.name,
              packageName: pkg?.name ?? mp.name ?? "Unknown package",
              remainingSessions: remaining,
              endDate: end,
              status: mp.status,
              reasons: [low ? "LOW_BALANCE" : null, expiring ? "EXPIRING_SOON" : null].filter(Boolean),
            });
          }
        }
      }

      const coaches = [...rows.values()]
        .map(({ clients, ...row }) => ({
          ...row,
          activeClients: clients.size,
          revenue: round2(row.revenue),
          avgSessionsPerClient: clients.size ? round2(row.sessions / clients.size) : 0,
        }))
        .sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue);

      const revenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        totals: {
          sessions: sessions.length,
          scanSessions: sessions.filter((s) => s.source === "SCAN").length,
          deductionSessions: sessions.filter((s) => s.source === "COACH_DEDUCTION").length,
          activeClients: coaches.reduce((sum, c) => sum + c.activeClients, 0),
          activePackages,
          remainingSessions: remainingTotal,
          remainingValue: round2(remainingValue),
          revenue: round2(revenue),
          sales: payments.length,
          newSales,
          renewals,
          renewalShare: payments.length ? round2((renewals / payments.length) * 100) : 0,
          lowBalance: alerts.filter((a) => a.reasons.includes("LOW_BALANCE")).length,
          expiringSoon: alerts.filter((a) => a.reasons.includes("EXPIRING_SOON")).length,
        },
        coaches,
        trend: buckets.map((bucket) => ({
          bucket,
          sessions: trend.get(bucket)!.sessions,
          revenue: round2(trend.get(bucket)!.revenue),
        })),
        alerts: alerts.sort(
          (a, b) => a.remainingSessions - b.remainingSessions || a.endDate.getTime() - b.endDate.getTime(),
        ),
      };
    });
  }

  /** Money collected for sessions/time not yet delivered. */
  static async deferredRevenue(range: FinanceRange) {
    return cached(`deferred|${rangeKey(range)}`, async () => {
      const lookups = await loadLookups();
      const [members, nonUserPackages, collectedPayments] = await Promise.all([
        Member.find({ "packages.0": { $exists: true } })
          .select("uid packages.pkgId packages.name packages.status packages.pkgStartDate packages.pkgEndDate packages.remainingClasses packages.locationId packages.adjustmentHistory.date packages.adjustmentHistory.amount packages.adjustmentHistory.type")
          .lean(),
        NonUserPackage.find({ added: { $ne: true } }).lean(),
        fetchPayments(range, {
          purpose: { $in: ["PACKAGE", "NON_USER_PACKAGE"] },
          paymentMethod: { $nin: NON_REVENUE_METHODS },
        }),
      ]);

      const now = new Date();
      const horizon = new Date(now.getTime() + 30 * DAY_MS);
      type CatRow = { category: string; unearned: number; sessionsOwed: number; packages: number; earned: number; breakage: number; expiredPackages: number };
      const cats = new Map<string, CatRow>();
      const catFor = (category: string) => {
        let row = cats.get(category);
        if (!row) {
          row = { category, unearned: 0, sessionsOwed: 0, packages: 0, earned: 0, breakage: 0, expiredPackages: 0 };
          cats.set(category, row);
        }
        return row;
      };
      const branches = new Map<string, { locationId: string; branchName: string; unearned: number; sessionsOwed: number }>();
      const expiringWeeks = new Map<string, number>();
      const expiring: AnyDoc[] = [];

      const consider = (
        pkgId: string,
        info: { status?: string; start: Date; end: Date; remaining: number; locationId: string | null; adjustments: AnyDoc[] },
        owner: { memberId: string | null; name?: string },
      ) => {
        const pkg = lookups.packages.get(pkgId);
        if (!pkg) return;
        const loc = info.locationId || pkg.locationId;
        if (range.locationId && loc && loc !== range.locationId) return;
        if (info.status === "DELETED") return;

        const cat = catFor(pkg.category);
        const perSession = perSessionValue(pkg);
        const totalMs = Math.max(1, info.end.getTime() - info.start.getTime());

        // Earned inside the range
        if (perSession !== null) {
          let used = 0;
          for (const adj of info.adjustments) {
            const at = new Date(adj.date);
            if (at < range.start || at >= range.end) continue;
            const amount = Number(adj.amount) || 0;
            used += adj.type === "DEDUCT" ? amount : -amount;
          }
          cat.earned += Math.max(0, used) * perSession;
        } else {
          const overlap =
            Math.min(info.end.getTime(), range.end.getTime(), now.getTime()) -
            Math.max(info.start.getTime(), range.start.getTime());
          if (overlap > 0) cat.earned += pkg.price * (overlap / totalMs);
        }

        // Expired with unused sessions inside the range
        if (
          perSession !== null &&
          info.remaining > 0 &&
          info.end >= range.start &&
          info.end < range.end &&
          info.end <= now
        ) {
          cat.breakage += info.remaining * perSession;
          cat.expiredPackages += 1;
        }

        // Still owed today
        const isLive = info.end > now && (!info.status || ["ACTIVE", "FROZEN"].includes(info.status));
        if (!isLive) return;
        let unearned = 0;
        let sessionsOwed = 0;
        if (perSession !== null) {
          sessionsOwed = Math.max(0, info.remaining);
          unearned = sessionsOwed * perSession;
        } else {
          const remainingMs = info.end.getTime() - Math.max(now.getTime(), info.start.getTime());
          unearned = pkg.price * Math.min(1, Math.max(0, remainingMs / totalMs));
        }
        if (unearned <= 0) return;
        cat.unearned += unearned;
        cat.sessionsOwed += sessionsOwed;
        cat.packages += 1;

        const branchKey = loc ?? "";
        const b = branches.get(branchKey) ?? { locationId: branchKey, branchName: branchName(lookups, loc), unearned: 0, sessionsOwed: 0 };
        b.unearned += unearned;
        b.sessionsOwed += sessionsOwed;
        branches.set(branchKey, b);

        if (info.end <= horizon && perSession !== null && sessionsOwed > 0) {
          const weekIndex = Math.floor((info.end.getTime() - now.getTime()) / (7 * DAY_MS));
          const weekLabel = `Week ${weekIndex + 1}`;
          expiringWeeks.set(weekLabel, (expiringWeeks.get(weekLabel) ?? 0) + unearned);
          expiring.push({
            memberId: owner.memberId,
            memberName: owner.name ?? "",
            packageName: pkg.name,
            category: pkg.category,
            remainingSessions: sessionsOwed,
            valueAtRisk: round2(unearned),
            endDate: info.end,
            branch: branchName(lookups, loc),
          });
        }
      };

      for (const m of members as AnyDoc[]) {
        for (const mp of m.packages ?? []) {
          consider(
            idStr(mp.pkgId),
            {
              status: mp.status,
              start: new Date(mp.pkgStartDate),
              end: new Date(mp.pkgEndDate),
              remaining: Number(mp.remainingClasses) || 0,
              locationId: mp.locationId ? idStr(mp.locationId) : null,
              adjustments: mp.adjustmentHistory ?? [],
            },
            { memberId: idStr(m.uid) },
          );
        }
      }
      for (const np of nonUserPackages as AnyDoc[]) {
        consider(
          idStr(np.pkgId),
          {
            start: new Date(np.pkgStartDate),
            end: new Date(np.pkgEndDate),
            remaining: Number(np.remainingClasses) || 0,
            locationId: null,
            adjustments: [],
          },
          { memberId: null, name: `${np.name} (non-member)` },
        );
      }

      const expiringSorted = expiring.sort((a, b) => a.endDate.getTime() - b.endDate.getTime()).slice(0, 100);
      const users = await loadUsers(expiringSorted.map((e) => e.memberId).filter(Boolean));
      for (const e of expiringSorted) {
        if (e.memberId) e.memberName = users.get(e.memberId)?.name ?? "Unknown member";
      }

      const categories = [...cats.values()]
        .map((c) => ({
          ...c,
          unearned: round2(c.unearned),
          earned: round2(c.earned),
          breakage: round2(c.breakage),
        }))
        .filter((c) => c.unearned || c.earned || c.breakage)
        .sort((a, b) => b.unearned - a.unearned);

      const sum = (key: "unearned" | "earned" | "breakage" | "sessionsOwed" | "packages" | "expiredPackages") =>
        round2(categories.reduce((s, c) => s + c[key], 0));

      return {
        asOf: now,
        range: { startDate: range.startKey, endDate: range.endKey },
        totals: {
          unearned: sum("unearned"),
          sessionsOwed: sum("sessionsOwed"),
          livePackages: sum("packages"),
          earnedInRange: sum("earned"),
          collectedInRange: round2(collectedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
          breakageInRange: sum("breakage"),
          expiredWithBalance: sum("expiredPackages"),
          expiringNext30Days: round2(expiring.reduce((s, e) => s + e.valueAtRisk, 0)),
        },
        categories,
        byBranch: [...branches.values()]
          .map((b) => ({ ...b, unearned: round2(b.unearned) }))
          .sort((a, b) => b.unearned - a.unearned),
        expiringByWeek: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]
          .map((week) => ({ week, value: round2(expiringWeeks.get(week) ?? 0) }))
          .filter((w, i) => i < 4 || w.value > 0),
        expiring: expiringSorted,
      };
    });
  }

  /** Side-by-side branch comparison (always all branches). */
  static async branches(inputRange: FinanceRange) {
    const range = { ...inputRange, locationId: null };
    return cached(`branches|${rangeKey(range)}`, async () => {
      const prev = previousRange(range);
      const [lookups, payments, refunds, prevPayments, prevRefunds, members, classes] = await Promise.all([
        loadLookups(),
        fetchPayments(range),
        fetchRefunds(range),
        fetchPayments(prev),
        fetchRefunds(prev),
        Member.find({ "packages.status": { $in: ["ACTIVE", "FROZEN"] } })
          .select("uid packages.pkgId packages.status packages.locationId packages.pkgEndDate")
          .lean(),
        ScheduledClass.find({ startTime: { $gte: range.start, $lt: range.end } })
          .select("locationId scans.status bookedMembers.uid")
          .lean(),
      ]);

      const ids = new Set<string>([...lookups.locations.keys()]);
      const byId = (rows: AnyDoc[], field: string) => {
        const map = new Map<string, AnyDoc[]>();
        for (const r of rows) {
          const key = idStr(r[field]);
          ids.add(key);
          map.set(key, [...(map.get(key) ?? []), r]);
        }
        return map;
      };
      const pay = byId(payments, "locationId");
      const ref = byId(refunds, "locationId");
      const prevPay = byId(prevPayments, "locationId");
      const prevRef = byId(prevRefunds, "locationId");

      const now = new Date();
      const activeMembers = new Map<string, Set<string>>();
      for (const m of members as AnyDoc[]) {
        for (const mp of m.packages ?? []) {
          if (!["ACTIVE", "FROZEN"].includes(mp.status) || isPackageExpired(mp.pkgEndDate, now)) continue;
          const loc = (mp.locationId && idStr(mp.locationId)) || lookups.packages.get(idStr(mp.pkgId))?.locationId || "";
          if (!activeMembers.has(loc)) activeMembers.set(loc, new Set());
          activeMembers.get(loc)!.add(idStr(m.uid));
        }
      }
      // Members on packages valid everywhere count once for "All branches" only.
      const sharedMembers = activeMembers.get("")?.size ?? 0;

      const classStats = new Map<string, { sessions: number; booked: number; attended: number }>();
      for (const c of classes as AnyDoc[]) {
        const key = idStr(c.locationId);
        const row = classStats.get(key) ?? { sessions: 0, booked: 0, attended: 0 };
        row.sessions += 1;
        row.booked += (c.bookedMembers ?? []).length;
        row.attended += (c.scans ?? []).filter((s: AnyDoc) => s.status !== false).length;
        classStats.set(key, row);
      }

      const buckets = rangeBuckets(range);
      const rows = [...ids]
        .filter((id) => id)
        .map((id) => {
          const cur = summarizeMoney(pay.get(id) ?? [], ref.get(id) ?? []);
          const before = summarizeMoney(prevPay.get(id) ?? [], prevRef.get(id) ?? []);
          const revenue = (pay.get(id) ?? []).filter(isRevenue);
          const methodShare = (methods: string[]) =>
            cur.gross
              ? round2(
                  (revenue.filter((p) => methods.includes(p.paymentMethod)).reduce((s, p) => s + (Number(p.amount) || 0), 0) /
                    cur.gross) *
                    100,
                )
              : 0;
          const active = activeMembers.get(id)?.size ?? 0;
          const trendMap = new Map(buckets.map((k) => [k, 0]));
          for (const p of revenue) {
            const key = cairoKey(new Date(p.paymentTime), range.granularity);
            if (trendMap.has(key)) trendMap.set(key, trendMap.get(key)! + (Number(p.amount) || 0));
          }
          for (const r of (ref.get(id) ?? []).filter((x) => x.type === "REFUND")) {
            const key = cairoKey(new Date(r.createdAt), range.granularity);
            if (trendMap.has(key)) trendMap.set(key, trendMap.get(key)! - (Number(r.amount) || 0));
          }
          const cls = classStats.get(id) ?? { sessions: 0, booked: 0, attended: 0 };
          return {
            locationId: id,
            branchName: branchName(lookups, id),
            ...cur,
            previousNet: before.net,
            netChange: percentChange(cur.net, before.net),
            refundRate: cur.gross ? round2((cur.refunds / cur.gross) * 100) : 0,
            cashShare: methodShare(["CASH"]),
            cardShare: methodShare(["VISA", "APP", "PAYMENT_LINK", "VALU"]),
            instapayShare: methodShare(["INSTAPAY"]),
            activeMembers: active,
            revenuePerMember: active ? round2(cur.net / active) : null,
            classSessions: cls.sessions,
            classBookings: cls.booked,
            classAttendance: cls.attended,
            trend: buckets.map((bucket) => ({ bucket, net: round2(trendMap.get(bucket) ?? 0) })),
          };
        })
        .filter((r) => lookups.locations.has(r.locationId) || r.gross || r.refunds || r.cashOuts)
        .sort((a, b) => b.net - a.net);

      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        previousRange: { startDate: prev.startKey, endDate: prev.endKey },
        branches: rows,
        allBranchMembers: sharedMembers,
        unassignedRefunds: round2((ref.get("") ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0)),
      };
    });
  }

  /** New vs renewing members, churn, lifetime value, top spenders and freezes. */
  static async retention(range: FinanceRange) {
    return cached(`retention|${rangeKey(range)}`, async () => {
      const lookups = await loadLookups();
      const [packagePayments, members, rangePayments] = await Promise.all([
        fetchPayments(range, {
          purpose: "PACKAGE",
          uid: { $exists: true, $ne: null },
          paymentMethod: { $nin: NON_REVENUE_METHODS },
        }),
        Member.find({ "packages.0": { $exists: true } })
          .select("uid packages._id packages.pkgId packages.status packages.pkgStartDate packages.pkgEndDate packages.remainingClasses packages.locationId packages.freezeInfo")
          .lean(),
        fetchPayments(range, {
          uid: { $exists: true, $ne: null },
          paymentMethod: { $nin: NON_REVENUE_METHODS },
        }),
      ]);

      const payerIds = [...new Set(packagePayments.map((p) => idStr(p.uid)))];
      const firstPackage = payerIds.length
        ? await Payment.aggregate([
            {
              $match: {
                uid: { $in: payerIds.map((id) => new Types.ObjectId(id)) },
                purpose: "PACKAGE",
                paymentMethod: { $nin: NON_REVENUE_METHODS },
              },
            },
            { $group: { _id: "$uid", first: { $min: "$paymentTime" } } },
          ])
        : [];
      const firstMap = new Map(firstPackage.map((f: AnyDoc) => [idStr(f._id), new Date(f.first)]));

      const buckets = rangeBuckets(range);
      const trend = new Map(buckets.map((k) => [k, { newMembers: new Set<string>(), renewing: new Set<string>() }]));
      const newIds = new Set<string>();
      const renewIds = new Set<string>();
      let newRevenue = 0;
      let renewRevenue = 0;
      for (const p of packagePayments) {
        const uid = idStr(p.uid);
        const first = firstMap.get(uid);
        const isNew = !first || first >= range.start;
        const amount = Number(p.amount) || 0;
        if (isNew) {
          newIds.add(uid);
          newRevenue += amount;
        } else {
          renewIds.add(uid);
          renewRevenue += amount;
        }
        const t = trend.get(cairoKey(new Date(p.paymentTime), range.granularity));
        if (t) (isNew ? t.newMembers : t.renewing).add(uid);
      }

      // Churn: packages that ended in the range and were not followed by another package.
      const now = new Date();
      const endCap = range.end < now ? range.end : now;
      const byCategory = new Map<string, { category: string; ended: number; renewed: number }>();
      const churned: AnyDoc[] = [];
      let ended = 0;
      let renewed = 0;
      let frozenNow = 0;
      let frozenSessions = 0;
      let frozenValue = 0;
      let freezesStarted = 0;
      let freezeDays = 0;
      const activeNow = new Set<string>();

      for (const m of members as AnyDoc[]) {
        const pkgs = (m.packages ?? []).filter((mp: AnyDoc) => mp.status !== "DELETED");
        for (const mp of pkgs) {
          const pkg = lookups.packages.get(idStr(mp.pkgId));
          const loc = (mp.locationId && idStr(mp.locationId)) || pkg?.locationId || null;
          if (range.locationId && loc && loc !== range.locationId) continue;
          const start = new Date(mp.pkgStartDate);
          const end = new Date(mp.pkgEndDate);

          if (["ACTIVE", "FROZEN"].includes(mp.status) && end >= now) activeNow.add(idStr(m.uid));

          const freeze = mp.freezeInfo;
          if (freeze?.isFrozen || mp.status === "FROZEN") {
            frozenNow += 1;
            const remaining = Number(mp.remainingClasses) || 0;
            const perSession = perSessionValue(pkg);
            if (perSession !== null) {
              frozenSessions += remaining;
              frozenValue += remaining * perSession;
            }
          }
          for (const h of freeze?.freezeHistory ?? []) {
            const hs = new Date(h.startDate);
            if (hs >= range.start && hs < range.end) {
              freezesStarted += 1;
              freezeDays += Number(h.durationDays) || 0;
            }
          }

          if (end < range.start || end >= endCap) continue;
          ended += 1;
          const category = pkg?.category ?? "UNCATEGORIZED";
          const cat = byCategory.get(category) ?? { category, ended: 0, renewed: 0 };
          cat.ended += 1;
          const followUp = pkgs.some((other: AnyDoc) => {
            if (String(other._id) === String(mp._id)) return false;
            const os = new Date(other.pkgStartDate);
            return os > start && os <= new Date(end.getTime() + 30 * DAY_MS);
          });
          if (followUp) {
            renewed += 1;
            cat.renewed += 1;
          } else {
            churned.push({ memberId: idStr(m.uid), packageName: pkg?.name ?? "Unknown package", category, endDate: end });
          }
          byCategory.set(category, cat);
        }
      }

      // Lifetime value (all-time paid per paying member).
      const ltvMatch: Record<string, unknown> = {
        uid: { $exists: true, $ne: null },
        paymentMethod: { $nin: NON_REVENUE_METHODS },
      };
      const ltvPipeline: any[] = [
        { $match: range.locationId ? { $and: [ltvMatch, locationIdScalarQuery(range.locationId)] } : ltvMatch },
        { $group: { _id: "$uid", total: { $sum: "$amount" }, payments: { $sum: 1 } } },
        { $sort: { total: 1 } },
      ];
      const ltvRows = (await Payment.aggregate(ltvPipeline)) as AnyDoc[];
      const ltvTotal = ltvRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
      const median = ltvRows.length ? Number(ltvRows[Math.floor(ltvRows.length / 2)].total) || 0 : 0;

      const spend = new Map<string, { total: number; payments: number }>();
      for (const p of rangePayments) {
        const uid = idStr(p.uid);
        const row = spend.get(uid) ?? { total: 0, payments: 0 };
        row.total += Number(p.amount) || 0;
        row.payments += 1;
        spend.set(uid, row);
      }
      const top = [...spend.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
      const churnSample = churned.sort((a, b) => b.endDate.getTime() - a.endDate.getTime()).slice(0, 50);
      const users = await loadUsers([...top.map(([id]) => id), ...churnSample.map((c) => c.memberId)]);
      const ltvByUser = new Map(ltvRows.map((r) => [idStr(r._id), Number(r.total) || 0]));

      const signups = await User.countDocuments({
        role: "member",
        createdAt: { $gte: range.start, $lt: range.end },
      });

      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        totals: {
          activeMembers: activeNow.size,
          newSignups: signups,
          newPayingMembers: newIds.size,
          renewingMembers: renewIds.size,
          newRevenue: round2(newRevenue),
          renewalRevenue: round2(renewRevenue),
          packagesEnded: ended,
          packagesRenewed: renewed,
          renewalRate: ended ? round2((renewed / ended) * 100) : null,
          churnRate: ended ? round2(((ended - renewed) / ended) * 100) : null,
          lifetimeValueAvg: ltvRows.length ? round2(ltvTotal / ltvRows.length) : 0,
          lifetimeValueMedian: round2(median),
          payingMembersAllTime: ltvRows.length,
          frozenPackages: frozenNow,
          frozenSessions,
          frozenValue: round2(frozenValue),
          freezesStarted,
          freezeDays,
        },
        trend: buckets.map((bucket) => ({
          bucket,
          newMembers: trend.get(bucket)!.newMembers.size,
          renewingMembers: trend.get(bucket)!.renewing.size,
        })),
        byCategory: [...byCategory.values()]
          .map((c) => ({ ...c, renewalRate: c.ended ? round2((c.renewed / c.ended) * 100) : null }))
          .sort((a, b) => b.ended - a.ended),
        topSpenders: top.map(([id, v]) => ({
          memberId: id,
          name: users.get(id)?.name ?? "Unknown member",
          phone: users.get(id)?.phone ?? "",
          total: round2(v.total),
          payments: v.payments,
          lifetimeValue: round2(ltvByUser.get(id) ?? v.total),
        })),
        churned: churnSample.map((c) => ({
          ...c,
          name: users.get(c.memberId)?.name ?? "Unknown member",
          phone: users.get(c.memberId)?.phone ?? "",
        })),
      };
    });
  }

  /** Every transaction, cash check per day, online reference check and anomaly flags. */
  static async ledger(
    range: FinanceRange,
    options: { page: number; limit: number; search?: string; method?: string; type?: string; flaggedOnly?: boolean },
  ) {
    const base = await cached(`ledger|${rangeKey(range)}`, async () => {
      const [lookups, payments, refunds] = await Promise.all([
        loadLookups(),
        fetchPayments(range),
        fetchRefunds(range),
      ]);
      const [scheduled, users] = await Promise.all([
        loadScheduledClassCids(payments.map((p) => idStr(p.scid))),
        loadUsers([...payments.map((p) => idStr(p.uid)), ...refunds.map((r) => idStr(r.memberId)), ...refunds.map((r) => idStr(r.recordedBy))]),
      ]);

      const flags = new Map<string, Set<string>>();
      const flag = (id: string, code: string) => {
        if (!flags.has(id)) flags.set(id, new Set());
        flags.get(id)!.add(code);
      };

      // Duplicates: same payer, amount and item within 10 minutes.
      const sorted = [...payments].sort((a, b) => new Date(a.paymentTime).getTime() - new Date(b.paymentTime).getTime());
      const lastSeen = new Map<string, AnyDoc>();
      for (const p of sorted) {
        if (!isRevenue(p)) continue;
        const key = [idStr(p.uid) || `${p.nonMemberPhone}|${p.nonMemberName}`, p.amount, p.purpose, idStr(p.pkgId), idStr(p.scid)].join("|");
        const prevP = lastSeen.get(key);
        if (prevP && new Date(p.paymentTime).getTime() - new Date(prevP.paymentTime).getTime() <= 10 * 60 * 1000) {
          flag(idStr(p._id), "POSSIBLE_DUPLICATE");
          flag(idStr(prevP._id), "POSSIBLE_DUPLICATE");
        }
        lastSeen.set(key, p);
      }

      // Unusual amounts: more than 3 standard deviations above the mean for the same purpose.
      const byPurpose = new Map<string, number[]>();
      for (const p of payments.filter(isRevenue)) {
        byPurpose.set(p.purpose, [...(byPurpose.get(p.purpose) ?? []), Number(p.amount) || 0]);
      }
      const thresholds = new Map<string, number>();
      for (const [purpose, amounts] of byPurpose) {
        if (amounts.length < 10) continue;
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length);
        if (sd > 0) thresholds.set(purpose, mean + 3 * sd);
      }

      const refundedPaymentIds = new Set(refunds.map((r) => idStr(r.paymentId)).filter(Boolean));
      const linkedIds = [...refundedPaymentIds];
      const linkedPayments = linkedIds.length
        ? ((await Payment.find({ _id: { $in: linkedIds } }).select("amount").lean()) as AnyDoc[])
        : [];
      const linkedMap = new Map(linkedPayments.map((p) => [idStr(p._id), Number(p.amount) || 0]));

      for (const p of payments) {
        const id = idStr(p._id);
        const amount = Number(p.amount) || 0;
        if (isRevenue(p) && amount <= 0) flag(id, "ZERO_OR_NEGATIVE_AMOUNT");
        const limit = thresholds.get(p.purpose);
        if (isRevenue(p) && limit !== undefined && amount > limit) flag(id, "UNUSUAL_AMOUNT");
        if (ONLINE_METHODS.includes(p.paymentMethod) && !p.orderId && !p.merchantReferenceId) flag(id, "MISSING_ONLINE_REFERENCE");
        if (p.isRefunded && !refundedPaymentIds.has(id)) flag(id, "REFUNDED_WITHOUT_RECORD");
      }
      for (const r of refunds) {
        const id = idStr(r._id);
        if (r.type !== "REFUND") continue;
        if (!r.paymentId) continue;
        const linked = linkedMap.get(idStr(r.paymentId));
        if (linked === undefined) flag(id, "REFUND_PAYMENT_NOT_FOUND");
        else if ((Number(r.amount) || 0) > linked) flag(id, "REFUND_EXCEEDS_PAYMENT");
      }

      const rows = [
        ...payments.map((p) => {
          const pkg = p.pkgId ? lookups.packages.get(idStr(p.pkgId)) : undefined;
          const user = users.get(idStr(p.uid));
          const id = idStr(p._id);
          return {
            id,
            kind: "PAYMENT" as const,
            time: p.paymentTime,
            customer: user?.name || p.nonMemberName || "Walk-in customer",
            phone: user?.phone || p.nonMemberPhone || "",
            item: paymentItemName(p, lookups, scheduled),
            segment: paymentSegment(p.purpose, pkg?.category),
            purpose: p.purpose,
            method: p.paymentMethod,
            amount: round2(Number(p.amount) || 0),
            countsAsRevenue: isRevenue(p),
            branchId: idStr(p.locationId),
            branch: branchName(lookups, idStr(p.locationId)),
            reference: p.merchantReferenceId || p.orderId || "",
            note: p.note || p.refundReason || "",
            isRefunded: Boolean(p.isRefunded),
            recordedBy: "",
            flags: [...(flags.get(id) ?? [])],
          };
        }),
        ...refunds.map((r) => {
          const id = idStr(r._id);
          const user = users.get(idStr(r.memberId));
          return {
            id,
            kind: r.type as "REFUND" | "CASHOUT",
            time: r.createdAt,
            customer: r.type === "CASHOUT" ? "Cash out" : user?.name || r.memberName || "Unknown",
            phone: user?.phone || "",
            item: r.reason,
            segment: r.type,
            purpose: r.type,
            method: "CASH",
            amount: -round2(Number(r.amount) || 0),
            countsAsRevenue: false,
            branchId: idStr(r.locationId),
            branch: branchName(lookups, idStr(r.locationId)),
            reference: idStr(r.paymentId),
            note: r.reason,
            isRefunded: false,
            recordedBy: users.get(idStr(r.recordedBy))?.name ?? "",
            flags: [...(flags.get(id) ?? [])],
          };
        }),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      // Daily cash check per branch.
      const cash = new Map<string, { day: string; branchId: string; branch: string; cashIn: number; refundsOut: number; cashOuts: number }>();
      for (const row of rows) {
        if (row.method !== "CASH") continue;
        const day = cairoKey(new Date(row.time));
        const key = `${day}|${row.branchId}`;
        const entry = cash.get(key) ?? { day, branchId: row.branchId, branch: row.branch, cashIn: 0, refundsOut: 0, cashOuts: 0 };
        if (row.kind === "PAYMENT") entry.cashIn += row.amount;
        else if (row.kind === "REFUND") entry.refundsOut += -row.amount;
        else entry.cashOuts += -row.amount;
        cash.set(key, entry);
      }

      const online = rows.filter((r) => r.kind === "PAYMENT" && ONLINE_METHODS.includes(r.method));
      const flagCounts: Record<string, number> = {};
      for (const row of rows) for (const f of row.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;

      return {
        rows,
        cashByDay: [...cash.values()]
          .map((c) => ({
            ...c,
            cashIn: round2(c.cashIn),
            refundsOut: round2(c.refundsOut),
            cashOuts: round2(c.cashOuts),
            expectedInDrawer: round2(c.cashIn - c.refundsOut - c.cashOuts),
          }))
          .sort((a, b) => (a.day === b.day ? a.branch.localeCompare(b.branch) : b.day.localeCompare(a.day))),
        online: {
          count: online.length,
          amount: round2(online.reduce((s, r) => s + r.amount, 0)),
          withReference: online.filter((r) => r.reference).length,
          missingReference: online.filter((r) => !r.reference).length,
        },
        flagCounts,
      };
    });

    const search = options.search?.trim().toLowerCase();
    const filtered = base.rows.filter((r) => {
      if (options.type && options.type !== "ALL" && r.kind !== options.type) return false;
      if (options.method && options.method !== "ALL" && r.method !== options.method) return false;
      if (options.flaggedOnly && !r.flags.length) return false;
      if (search) {
        return [r.customer, r.phone, r.item, r.reference, r.branch, r.note, r.recordedBy].some((v) =>
          String(v ?? "").toLowerCase().includes(search),
        );
      }
      return true;
    });

    const moneyIn = base.rows.filter((r) => r.kind === "PAYMENT" && r.countsAsRevenue).reduce((s, r) => s + r.amount, 0);
    const moneyOut = base.rows.filter((r) => r.kind !== "PAYMENT").reduce((s, r) => s - r.amount, 0);
    return {
      range: { startDate: range.startKey, endDate: range.endKey },
      totals: {
        transactions: base.rows.length,
        moneyIn: round2(moneyIn),
        moneyOut: round2(moneyOut),
        net: round2(moneyIn - moneyOut),
        flagged: base.rows.filter((r) => r.flags.length).length,
      },
      flagCounts: base.flagCounts,
      online: base.online,
      cashByDay: base.cashByDay,
      transactions: paginate(filtered, options.page, options.limit),
    };
  }

  /** Refunds and cash outs: totals, reasons, branches and who recorded them. */
  static async refunds(range: FinanceRange) {
    return cached(`refunds|${rangeKey(range)}`, async () => {
      const [lookups, refunds, payments] = await Promise.all([
        loadLookups(),
        fetchRefunds(range),
        fetchPayments(range, { paymentMethod: { $nin: NON_REVENUE_METHODS } }),
      ]);
      const users = await loadUsers([
        ...refunds.map((r) => idStr(r.memberId)),
        ...refunds.map((r) => idStr(r.recordedBy)),
      ]);
      const linkedIds = refunds.map((r) => idStr(r.paymentId)).filter(Boolean);
      const linked = linkedIds.length
        ? ((await Payment.find({ _id: { $in: linkedIds } }).select("amount purpose pkgId scid paymentTime paymentMethod").lean()) as AnyDoc[])
        : [];
      const scheduled = await loadScheduledClassCids(linked.map((p) => idStr(p.scid)));
      const linkedMap = new Map(linked.map((p) => [idStr(p._id), p]));

      const gross = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const buckets = rangeBuckets(range);
      const trend = new Map(buckets.map((k) => [k, { refunds: 0, cashOuts: 0 }]));
      const reasons = new Map<string, { reason: string; type: string; amount: number; count: number }>();
      const branchesMap = new Map<string, { branch: string; refunds: number; cashOuts: number; count: number }>();
      const staff = new Map<string, { name: string; refunds: number; cashOuts: number; count: number }>();

      const rows = refunds.map((r) => {
        const amount = Number(r.amount) || 0;
        const isRefund = r.type === "REFUND";
        const t = trend.get(cairoKey(new Date(r.createdAt), range.granularity));
        if (t) {
          if (isRefund) t.refunds += amount;
          else t.cashOuts += amount;
        }
        const reasonKey = `${r.type}|${String(r.reason ?? "").trim().toLowerCase()}`;
        const reason = reasons.get(reasonKey) ?? { reason: String(r.reason ?? "").trim() || "No reason", type: r.type, amount: 0, count: 0 };
        reason.amount += amount;
        reason.count += 1;
        reasons.set(reasonKey, reason);

        const branchKey = idStr(r.locationId);
        const b = branchesMap.get(branchKey) ?? { branch: branchName(lookups, branchKey), refunds: 0, cashOuts: 0, count: 0 };
        if (isRefund) b.refunds += amount;
        else b.cashOuts += amount;
        b.count += 1;
        branchesMap.set(branchKey, b);

        const staffKey = idStr(r.recordedBy);
        const s = staff.get(staffKey) ?? { name: users.get(staffKey)?.name ?? "Unknown staff", refunds: 0, cashOuts: 0, count: 0 };
        if (isRefund) s.refunds += amount;
        else s.cashOuts += amount;
        s.count += 1;
        staff.set(staffKey, s);

        const payment = r.paymentId ? linkedMap.get(idStr(r.paymentId)) : undefined;
        return {
          id: idStr(r._id),
          time: r.createdAt,
          type: r.type,
          amount: round2(amount),
          reason: r.reason,
          member: r.type === "CASHOUT" ? "" : users.get(idStr(r.memberId))?.name || r.memberName || "",
          branch: branchName(lookups, branchKey),
          recordedBy: users.get(staffKey)?.name ?? "Unknown staff",
          linkedPayment: payment
            ? {
                id: idStr(payment._id),
                item: paymentItemName(payment, lookups, scheduled),
                amount: round2(Number(payment.amount) || 0),
                method: payment.paymentMethod,
                time: payment.paymentTime,
              }
            : null,
        };
      });

      const refundTotal = rows.filter((r) => r.type === "REFUND").reduce((s, r) => s + r.amount, 0);
      const cashOutTotal = rows.filter((r) => r.type === "CASHOUT").reduce((s, r) => s + r.amount, 0);
      const round = <T extends Record<string, any>>(o: T, keys: (keyof T)[]) => {
        const copy: Record<string, any> = { ...o };
        for (const k of keys) copy[k as string] = round2(Number(o[k]) || 0);
        return copy as T;
      };

      return {
        range: { startDate: range.startKey, endDate: range.endKey, granularity: range.granularity },
        totals: {
          refunds: round2(refundTotal),
          refundCount: rows.filter((r) => r.type === "REFUND").length,
          cashOuts: round2(cashOutTotal),
          cashOutCount: rows.filter((r) => r.type === "CASHOUT").length,
          gross: round2(gross),
          refundRate: gross ? round2((refundTotal / gross) * 100) : 0,
          avgRefund: rows.filter((r) => r.type === "REFUND").length
            ? round2(refundTotal / rows.filter((r) => r.type === "REFUND").length)
            : 0,
        },
        trend: buckets.map((bucket) => ({
          bucket,
          refunds: round2(trend.get(bucket)!.refunds),
          cashOuts: round2(trend.get(bucket)!.cashOuts),
        })),
        byReason: [...reasons.values()].map((r) => round(r, ["amount"])).sort((a, b) => b.amount - a.amount).slice(0, 12),
        byBranch: [...branchesMap.values()].map((b) => round(b, ["refunds", "cashOuts"])).sort((a, b) => b.refunds + b.cashOuts - (a.refunds + a.cashOuts)),
        byStaff: [...staff.values()].map((s) => round(s, ["refunds", "cashOuts"])).sort((a, b) => b.refunds + b.cashOuts - (a.refunds + a.cashOuts)),
        rows,
      };
    });
  }

  /** Coaches for pickers. */
  static async coaches() {
    const lookups = await loadLookups();
    return [...lookups.coaches.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Test hook: drop cached results. */
export function clearFinanceCache() {
  cache.clear();
}
