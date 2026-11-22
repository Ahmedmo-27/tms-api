/**
 * Cross-reference Method 1 (MongoDB) with Method 2 (Railway deploy logs).
 *
 * Method 2 logs are the Railway MCP snapshot in
 * railway-idempotent-fulfill-logs.json. Refresh that file from TMS-API
 * production deploy logs filtered by:
 *   Package subscribe idempotent fulfill from payment
 * over 2026-08-01T00:00:00Z .. 2026-11-18T00:00:00Z.
 * Each hit should be paired with the preceding POST /member/packages line.
 *
 * Usage:
 *   npx ts-node src/scripts/reconcile-audit-with-railway-logs.ts
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose, { Types } from "mongoose";
import {
  DAY_MS,
  DbAuditRow,
  HOUR_MS,
  PackageRef,
  PaymentRef,
  auditPaymentIdempotency,
  findRecycledPayment,
  loadPackagePayments,
  toPaymentRef,
} from "./audit-payment-idempotency";
import Payment from "../models/payment";

const RETENTION_START = new Date("2026-11-10T23:48:11.000Z");
const LOG_MATCH_MS = 15 * 60 * 1000;
const WEIGHT_MISSING_PAYMENT = 40;
const WEIGHT_HISTORICAL = 20;
const WEIGHT_RAILWAY = 30;
const WEIGHT_ACTIVE = 10;

interface RailwayEntry {
  logTimestamp: string;
  ingestedAt?: string;
  recycledPaymentId: string;
  merchantReferenceId: string;
  routeLogTimestamp?: string | null;
  routePkgId?: string | null;
  message?: string;
}

interface RailwaySnapshot {
  queriedFrom?: string;
  queriedTo?: string;
  retention?: {
    absentBefore?: string;
    earliestObservedLog?: string;
    note?: string;
  };
  entries?: RailwayEntry[];
}

interface Factors {
  databaseMissingPayment: number;
  historicalPaymentMatch: number;
  directRailwayLogProof: number;
  activeUnusedOrPartial: number;
}

type Category = "Definitive" | "High Confidence" | "Needs Manual Review";

interface ScoredIncident {
  uid: string;
  userName: string;
  userPhone: string;
  packageName: string;
  packageId: string;
  packageSubdocId: string | null;
  pkgStartDate: string | null;
  packageCreatedAt: string | null;
  status: string | null;
  remainingClasses: number | null;
  recycledPaymentId: string;
  recycledPaymentDate: string;
  recycledPaymentMref: string;
  railwayLogTimestamp: string | null;
  railwayRouteTimestamp: string | null;
  timeGapHours: number | null;
  logCoverage: "matched" | "outside_retention" | "inside_retention_no_log" | "log_without_package";
  factors: Factors;
  score: number;
  category: Category;
  inMethod1: boolean;
  inMethod2: boolean;
}

interface BenignRetry {
  recycledPaymentId: string;
  merchantReferenceId: string;
  railwayLogTimestamp: string;
  paymentTime: string | null;
  timeGapHours: number | null;
  note: string;
}

function categoryFor(score: number): Category {
  if (score >= 90) return "Definitive";
  if (score >= 60) return "High Confidence";
  return "Needs Manual Review";
}

function cairoDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function hoursBetween(later: Date, earlier: Date): number {
  return Number(((later.getTime() - earlier.getTime()) / HOUR_MS).toFixed(2));
}

function loadRailwayEntries(): { snapshot: RailwaySnapshot; entries: RailwayEntry[] } {
  const snapshotPath = path.join(__dirname, "railway-idempotent-fulfill-logs.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as RailwaySnapshot;
  return { snapshot, entries: snapshot.entries ?? [] };
}

function indexPackages(packages: PackageRef[]): Map<string, PackageRef[]> {
  const byKey = new Map<string, PackageRef[]>();
  for (const pkg of packages) {
    const key = `${pkg.uid}|${pkg.staticMerchantReferenceId}`;
    const list = byKey.get(key);
    if (list) list.push(pkg);
    else byKey.set(key, [pkg]);
  }
  return byKey;
}

function matchPackage(
  packages: PackageRef[],
  logTime: Date,
  routePkgId: string | null,
): { pkg: PackageRef; how: "createdAt" | "startDate" } | null {
  const pool = routePkgId
    ? packages.filter((pkg) => pkg.packageId === routePkgId)
    : packages;
  const candidates = pool.length > 0 ? pool : packages;

  let best: { pkg: PackageRef; delta: number } | null = null;
  for (const pkg of candidates) {
    if (!pkg.packageCreatedAt) continue;
    const delta = Math.abs(pkg.packageCreatedAt.getTime() - logTime.getTime());
    if (delta > LOG_MATCH_MS) continue;
    if (!best || delta < best.delta) best = { pkg, delta };
  }
  if (best) return { pkg: best.pkg, how: "createdAt" };

  const logDay = cairoDate(logTime);
  const sameDay = candidates.filter((pkg) => cairoDate(pkg.pkgStartDate) === logDay);
  if (sameDay.length === 1) return { pkg: sameDay[0], how: "startDate" };
  return null;
}

function isActiveUnused(status: string | null, remaining: number | null): boolean {
  return status === "ACTIVE" && typeof remaining === "number" && remaining > 0;
}

function historicalMatch(paymentTime: Date, reference: Date): boolean {
  return reference.getTime() - paymentTime.getTime() > DAY_MS;
}

function scoreRow(input: {
  missingPayment: boolean;
  historical: boolean;
  railwayProof: boolean;
  activeUnused: boolean;
}): { factors: Factors; score: number; category: Category } {
  const factors: Factors = {
    databaseMissingPayment: input.missingPayment ? WEIGHT_MISSING_PAYMENT : 0,
    historicalPaymentMatch: input.historical ? WEIGHT_HISTORICAL : 0,
    directRailwayLogProof: input.railwayProof ? WEIGHT_RAILWAY : 0,
    activeUnusedOrPartial: input.activeUnused ? WEIGHT_ACTIVE : 0,
  };
  const score =
    factors.databaseMissingPayment +
    factors.historicalPaymentMatch +
    factors.directRailwayLogProof +
    factors.activeUnusedOrPartial;
  return { factors, score, category: categoryFor(score) };
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function renderTable(incidents: ScoredIncident[]): string {
  const header = [
    "Member",
    "Phone",
    "Package",
    "Start (Cairo)",
    "Status",
    "Remaining",
    "Recycled payment",
    "Payment date (Cairo)",
    "Railway log (Cairo)",
    "Score",
    "Category",
  ];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of incidents) {
    const cells = [
      mdCell(row.userName || row.uid),
      mdCell(row.userPhone || "—"),
      mdCell(row.packageName || row.packageId || "—"),
      row.pkgStartDate ? formatWhen(row.pkgStartDate) : "—",
      row.status ?? "—",
      row.remainingClasses === null ? "—" : String(row.remainingClasses),
      row.recycledPaymentId,
      formatWhen(row.recycledPaymentDate),
      formatWhen(row.railwayLogTimestamp),
      String(row.score),
      row.category,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

async function ensureMemberContext(
  uid: string,
  packages: PackageRef[],
  paymentsByUid: Map<string, PaymentRef[]>,
  names: Map<string, { name: string; phone: string }>,
): Promise<void> {
  if (paymentsByUid.has(uid) && names.has(uid)) return;
  const User = (await import("../models/user")).default;
  const Member = (await import("../models/member")).default;
  if (!names.has(uid)) {
    const user = await User.findById(uid).select("name phoneNumber").lean();
    names.set(uid, {
      name: user?.name ?? "",
      phone: user?.phoneNumber ?? "",
    });
  }
  if (!paymentsByUid.has(uid)) {
    const loaded = await loadPackagePayments([uid]);
    paymentsByUid.set(uid, loaded.get(uid) ?? []);
  }
  const member = await Member.findOne({ uid: new Types.ObjectId(uid) }, { uid: 1, packages: 1 }).lean();
  if (!member) return;
  const { staticMerchantReferenceId } = await import("./audit-payment-idempotency");
  const seen = new Set(
    packages.filter((pkg) => pkg.uid === uid && pkg.packageSubdocId).map((pkg) => pkg.packageSubdocId),
  );
  for (const raw of member.packages ?? []) {
    if (!raw.pkgId || !raw.pkgStartDate) continue;
    const subdocId = raw._id ? String(raw._id) : null;
    if (subdocId && seen.has(subdocId)) continue;
    const packageId = String(raw.pkgId);
    let packageCreatedAt: Date | null = null;
    if (raw._id) {
      try {
        packageCreatedAt = new Types.ObjectId(String(raw._id)).getTimestamp();
      } catch {
        packageCreatedAt = null;
      }
    }
    packages.push({
      uid,
      packageSubdocId: raw._id ? String(raw._id) : null,
      packageName: raw.name ?? "",
      packageId,
      pkgStartDate: new Date(raw.pkgStartDate),
      packageCreatedAt,
      status: raw.status ?? "",
      remainingClasses: typeof raw.remainingClasses === "number" ? raw.remainingClasses : 0,
      staticMerchantReferenceId: staticMerchantReferenceId(packageId, uid),
    });
  }
}

async function connect(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not defined in prod.env");
  await mongoose.connect(uri);
}

async function main(): Promise<void> {
  const { snapshot, entries } = loadRailwayEntries();
  await connect();
  try {
    const audit = await auditPaymentIdempotency();
    const names = new Map(
      audit.rows.map((row) => [row.uid, { name: row.userName, phone: row.userPhone }]),
    );
    const userDocsNeeded = new Set(audit.packages.map((pkg) => pkg.uid));
    if (names.size < userDocsNeeded.size) {
      const User = (await import("../models/user")).default;
      const missing = [...userDocsNeeded].filter((uid) => !names.has(uid));
      if (missing.length > 0) {
        const docs = await User.find({ _id: { $in: missing } }).select("name phoneNumber").lean();
        for (const user of docs) {
          names.set(String(user._id), { name: user.name ?? "", phone: user.phoneNumber ?? "" });
        }
      }
    }

    const paymentIds = entries.map((entry) => entry.recycledPaymentId);
    const loggedPayments = (await Payment.find({ _id: { $in: paymentIds } })
      .select("uid pkgId paymentTime paymentMethod merchantReferenceId isRefunded purpose")
      .lean()) as unknown as Array<{
      _id: Types.ObjectId;
      uid?: Types.ObjectId;
      pkgId?: Types.ObjectId;
      paymentTime?: Date;
      paymentMethod?: string;
      merchantReferenceId?: string;
      isRefunded?: boolean;
      purpose?: string;
    }>;
    const paymentById = new Map<string, PaymentRef>();
    for (const doc of loggedPayments) {
      const payment = toPaymentRef(doc);
      if (payment) paymentById.set(payment.id, payment);
    }

    for (const entry of entries) {
      const payment = paymentById.get(entry.recycledPaymentId);
      if (!payment?.uid) continue;
      await ensureMemberContext(payment.uid, audit.packages, audit.paymentsByUid, names);
    }

    const packagesByKey = indexPackages(audit.packages);
    const method1BySubdoc = new Map<string, DbAuditRow>();
    for (const row of audit.rows) {
      if (row.packageSubdocId) method1BySubdoc.set(row.packageSubdocId, row);
    }

    const consumedLogs = new Set<number>();
    const incidents: ScoredIncident[] = [];
    const benignRetries: BenignRetry[] = [];

    function logForPackage(pkg: PackageRef): { entry: RailwayEntry; index: number } | null {
      if (!pkg.packageCreatedAt) return null;
      let best: { entry: RailwayEntry; index: number; delta: number } | null = null;
      for (let index = 0; index < entries.length; index += 1) {
        if (consumedLogs.has(index)) continue;
        const entry = entries[index];
        if (entry.merchantReferenceId !== pkg.staticMerchantReferenceId) continue;
        const logTime = new Date(entry.logTimestamp);
        const delta = Math.abs(pkg.packageCreatedAt.getTime() - logTime.getTime());
        if (delta > LOG_MATCH_MS) continue;
        if (!best || delta < best.delta) best = { entry, index, delta };
      }
      if (!best) return null;
      return { entry: best.entry, index: best.index };
    }

    for (const row of audit.rows) {
      const pkg = audit.packages.find(
        (item) => item.packageSubdocId && item.packageSubdocId === row.packageSubdocId,
      );
      const matched = pkg ? logForPackage(pkg) : null;
      if (matched) consumedLogs.add(matched.index);

      const paymentTime = new Date(row.recycledPaymentDate);
      const reference = row.packageCreatedAt
        ? new Date(row.packageCreatedAt)
        : new Date(row.pkgStartDate);
      let railwayProof = false;
      let timeGapHours: number | null = null;
      let logCoverage: ScoredIncident["logCoverage"] = "outside_retention";

      if (matched) {
        const logTime = new Date(matched.entry.logTimestamp);
        timeGapHours = hoursBetween(logTime, paymentTime);
        railwayProof = timeGapHours > 1;
        logCoverage = railwayProof ? "matched" : "inside_retention_no_log";
        if (!railwayProof) {
          benignRetries.push({
            recycledPaymentId: row.recycledPaymentId,
            merchantReferenceId: row.recycledPaymentMref,
            railwayLogTimestamp: matched.entry.logTimestamp,
            paymentTime: row.recycledPaymentDate,
            timeGapHours,
            note: "Idempotent fulfill log is within 1 hour of the original payment, so it is a recent retry rather than a recycled grant.",
          });
        }
      } else if (reference.getTime() >= RETENTION_START.getTime()) {
        logCoverage = "inside_retention_no_log";
      }

      const scored = scoreRow({
        missingPayment: true,
        historical: historicalMatch(paymentTime, reference),
        railwayProof,
        activeUnused: isActiveUnused(row.status, row.remainingClasses),
      });

      incidents.push({
        uid: row.uid,
        userName: row.userName,
        userPhone: row.userPhone,
        packageName: row.packageName,
        packageId: row.packageId,
        packageSubdocId: row.packageSubdocId,
        pkgStartDate: row.pkgStartDate,
        packageCreatedAt: row.packageCreatedAt,
        status: row.status,
        remainingClasses: row.remainingClasses,
        recycledPaymentId: row.recycledPaymentId,
        recycledPaymentDate: row.recycledPaymentDate,
        recycledPaymentMref: row.recycledPaymentMref,
        railwayLogTimestamp: matched ? matched.entry.logTimestamp : null,
        railwayRouteTimestamp: matched?.entry.routeLogTimestamp ?? null,
        timeGapHours,
        logCoverage,
        ...scored,
        inMethod1: true,
        inMethod2: railwayProof,
      });
    }

    for (let index = 0; index < entries.length; index += 1) {
      if (consumedLogs.has(index)) continue;
      const entry = entries[index];
      const payment = paymentById.get(entry.recycledPaymentId) ?? null;
      const logTime = new Date(entry.logTimestamp);
      const timeGapHours = payment ? hoursBetween(logTime, payment.paymentTime) : null;
      if (timeGapHours !== null && timeGapHours <= 1) {
        benignRetries.push({
          recycledPaymentId: entry.recycledPaymentId,
          merchantReferenceId: entry.merchantReferenceId,
          railwayLogTimestamp: entry.logTimestamp,
          paymentTime: payment ? payment.paymentTime.toISOString() : null,
          timeGapHours,
          note: "Idempotent fulfill log is within 1 hour of the original payment, so it is a recent retry rather than a recycled grant.",
        });
        continue;
      }

      const uid = payment?.uid ?? "";
      const key = uid ? `${uid}|${entry.merchantReferenceId}` : "";
      const pool = key ? packagesByKey.get(key) ?? [] : [];
      const matched = pool.length
        ? matchPackage(pool, logTime, entry.routePkgId ?? null)
        : null;
      const pkg = matched?.how === "createdAt" ? matched.pkg : null;
      if (pkg?.packageSubdocId && method1BySubdoc.has(pkg.packageSubdocId)) continue;

      const user = uid ? names.get(uid) : undefined;
      const paymentTime = payment?.paymentTime ?? null;
      const reference = pkg?.packageCreatedAt ?? logTime;
      const railwayProof = Boolean(pkg) && timeGapHours !== null && timeGapHours > 1;
      const dbMissing = pkg
        ? findRecycledPayment(audit.paymentsByUid.get(pkg.uid) ?? [], pkg) !== null
        : false;
      const scored = scoreRow({
        missingPayment: dbMissing,
        historical: paymentTime !== null && historicalMatch(paymentTime, reference),
        railwayProof,
        activeUnused: isActiveUnused(pkg?.status ?? null, pkg?.remainingClasses ?? null),
      });

      incidents.push({
        uid,
        userName: user?.name ?? "",
        userPhone: user?.phone ?? "",
        packageName: pkg?.packageName ?? "",
        packageId: pkg?.packageId ?? entry.routePkgId ?? entry.merchantReferenceId.slice(0, 24),
        packageSubdocId: pkg?.packageSubdocId ?? null,
        pkgStartDate: pkg ? pkg.pkgStartDate.toISOString() : null,
        packageCreatedAt: pkg?.packageCreatedAt ? pkg.packageCreatedAt.toISOString() : null,
        status: pkg?.status ?? null,
        remainingClasses: pkg?.remainingClasses ?? null,
        recycledPaymentId: entry.recycledPaymentId,
        recycledPaymentDate: paymentTime ? paymentTime.toISOString() : "",
        recycledPaymentMref: entry.merchantReferenceId,
        railwayLogTimestamp: entry.logTimestamp,
        railwayRouteTimestamp: entry.routeLogTimestamp ?? null,
        timeGapHours,
        logCoverage: pkg ? "matched" : "log_without_package",
        ...scored,
        inMethod1: dbMissing,
        inMethod2: timeGapHours !== null && timeGapHours > 1,
      });
    }

    incidents.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = a.railwayLogTimestamp ?? a.pkgStartDate ?? "";
      const bTime = b.railwayLogTimestamp ?? b.pkgStartDate ?? "";
      return bTime.localeCompare(aTime);
    });

    const countCategory = (category: Category, activeOnly: boolean) =>
      incidents.filter((row) => {
        if (row.category !== category) return false;
        if (!activeOnly) return true;
        return isActiveUnused(row.status, row.remainingClasses);
      }).length;

    const activeInsideRetentionUnlogged = incidents.filter(
      (row) =>
        row.status === "ACTIVE" &&
        row.logCoverage === "inside_retention_no_log" &&
        (row.remainingClasses ?? 0) > 0,
    ).length;

    const summary = {
      method1Candidates: audit.rows.length,
      method2LogLines: entries.length,
      method2ConfirmedOldPayments: incidents.filter((row) => row.inMethod2).length,
      benignRetriesWithinOneHour: benignRetries.length,
      joinedOnUidMrefAndTime: incidents.filter((row) => row.inMethod1 && row.inMethod2).length,
      byCategory: {
        definitive: countCategory("Definitive", false),
        highConfidence: countCategory("High Confidence", false),
        needsManualReview: countCategory("Needs Manual Review", false),
      },
      activeWithRemainingClasses: {
        definitive: countCategory("Definitive", true),
        highConfidence: countCategory("High Confidence", true),
        needsManualReview: countCategory("Needs Manual Review", true),
        insideRetentionWithoutLog: activeInsideRetentionUnlogged,
      },
    };

    const report = {
      generatedAt: new Date().toISOString(),
      database: process.env.MONGO_URI ? "prod.env MONGO_URI" : "missing",
      window: {
        vulnerabilityFrom: "2026-08-01T00:00:00.000Z",
        vulnerabilityTo: "2026-11-17T23:59:59.000Z",
        packageStartOnOrAfter: "2026-08-01T00:00:00.000Z",
      },
      railway: {
        service: "TMS-API",
        queriedFrom: snapshot.queriedFrom ?? "2026-08-01T00:00:00.000Z",
        queriedTo: snapshot.queriedTo ?? "2026-11-18T00:00:00.000Z",
        filter: "Package subscribe idempotent fulfill from payment",
        retention: snapshot.retention ?? {
          earliestObservedLog: RETENTION_START.toISOString(),
        },
        fulfillmentLogs: entries.length,
      },
      scan: {
        members: audit.scannedMembers,
        packagesSinceWindowStart: audit.scannedPackages,
      },
      weights: {
        databaseMissingPayment: WEIGHT_MISSING_PAYMENT,
        historicalPaymentMatch: `+${WEIGHT_HISTORICAL} when the APP merchantReferenceId payment is more than 1 day older than the package grant`,
        directRailwayLogProof: `+${WEIGHT_RAILWAY} when the fulfill log is within 15 minutes of package creation and the payment is more than 1 hour older`,
        activeUnusedOrPartial: `+${WEIGHT_ACTIVE} when status is ACTIVE and remainingClasses > 0`,
      },
      summary,
      benignRetries,
      incidents,
    };

    const method1Path = path.join(__dirname, "payment-audit-results.json");
    fs.writeFileSync(
      method1Path,
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          windowStart: "2026-08-01T00:00:00.000Z",
          scannedMembers: audit.scannedMembers,
          scannedPackages: audit.scannedPackages,
          count: audit.rows.length,
          incidents: audit.rows.map((row) => ({
            uid: row.uid,
            userName: row.userName,
            userPhone: row.userPhone,
            packageName: row.packageName,
            packageId: row.packageId,
            pkgStartDate: row.pkgStartDate,
            status: row.status,
            remainingClasses: row.remainingClasses,
            recycledPaymentId: row.recycledPaymentId,
            recycledPaymentDate: row.recycledPaymentDate,
            recycledPaymentMref: row.recycledPaymentMref,
            packageCreatedAt: row.packageCreatedAt,
            paymentGapHours: row.paymentGapHours,
          })),
        },
        null,
        2,
      ),
    );

    const outPath = path.join(__dirname, "payment-audit-weighted-scores.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    const active = summary.activeWithRemainingClasses;
    console.log("");
    console.log("Payment idempotency recycle audit");
    console.log(
      `Scanned ${audit.scannedPackages} packages on ${audit.scannedMembers} members with a start on or after 1 Aug 2026.`,
    );
    console.log(
      `Method 1 database candidates: ${summary.method1Candidates}. Method 2 Railway fulfill logs in retention: ${summary.method2LogLines} (${summary.method2ConfirmedOldPayments} tied to a package with a payment older than 1 hour). Joined on both: ${summary.joinedOnUidMrefAndTime}.`,
    );
    console.log(
      `Railway retention starts ${RETENTION_START.toISOString()}. Earlier grants cannot be confirmed from logs.`,
    );
    console.log("");
    console.log(
      `ACTIVE packages with classes remaining — Definitive: ${active.definitive}. High Confidence: ${active.highConfidence}. Needs Manual Review: ${active.needsManualReview}.`,
    );
    console.log(
      `Of those ACTIVE rows, ${active.insideRetentionWithoutLog} sit inside the log retention window with no fulfill line (database pattern only).`,
    );
    console.log(
      `All incidents — Definitive: ${summary.byCategory.definitive}. High Confidence: ${summary.byCategory.highConfidence}. Needs Manual Review: ${summary.byCategory.needsManualReview}.`,
    );
    console.log("");
    console.log(renderTable(incidents));
    console.log("");
    console.log(`Wrote ${method1Path}`);
    console.log(`Wrote ${outPath}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
