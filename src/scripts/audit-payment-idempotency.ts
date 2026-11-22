/**
 * Method 1 — database reconciliation for the package-subscribe idempotency recycle.
 *
 * Flags member packages with pkgStartDate on or after 2026-08-01 where:
 *   - no Payment for the same member and package exists within ±3 days of pkgStartDate
 *   - an older non-refunded APP payment carries the static merchantReferenceId
 *     (packageId + last 4 hex chars of uid) and was created more than 1 hour
 *     before the package subdocument was created
 *
 * The runtime lookup is the oldest non-refunded PACKAGE payment for that
 * merchantReferenceId, which is the document the vulnerable fulfill path reused.
 *
 * Usage:
 *   npx ts-node src/scripts/audit-payment-idempotency.ts
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose, { Types } from "mongoose";
import Member from "../models/member";
import Payment from "../models/payment";
import User from "../models/user";

export const AUDIT_WINDOW_START = new Date("2026-08-01T00:00:00.000Z");
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const MATCH_WINDOW_MS = 3 * DAY_MS;

export interface PaymentRef {
  id: string;
  uid: string;
  pkgId: string;
  paymentTime: Date;
  paymentMethod: string;
  merchantReferenceId: string;
  isRefunded: boolean;
  purpose: string;
}

export interface PackageRef {
  uid: string;
  packageSubdocId: string | null;
  packageName: string;
  packageId: string;
  pkgStartDate: Date;
  packageCreatedAt: Date | null;
  status: string;
  remainingClasses: number;
  staticMerchantReferenceId: string;
}

export interface DbAuditRow {
  uid: string;
  userName: string;
  userPhone: string;
  packageName: string;
  packageId: string;
  packageSubdocId: string | null;
  pkgStartDate: string;
  packageCreatedAt: string | null;
  status: string;
  remainingClasses: number;
  recycledPaymentId: string;
  recycledPaymentDate: string;
  recycledPaymentMref: string;
  paymentGapHours: number;
  gapReference: "packageCreatedAt" | "pkgStartDate";
}

export interface DatabaseAudit {
  scannedMembers: number;
  scannedPackages: number;
  rows: DbAuditRow[];
  packages: PackageRef[];
  paymentsByUid: Map<string, PaymentRef[]>;
}

interface LeanPackage {
  _id?: Types.ObjectId;
  pkgId?: Types.ObjectId;
  name?: string;
  pkgStartDate?: Date;
  status?: string;
  remainingClasses?: number;
}

interface LeanPayment {
  _id: Types.ObjectId;
  uid?: Types.ObjectId;
  pkgId?: Types.ObjectId;
  paymentTime?: Date;
  paymentMethod?: string;
  merchantReferenceId?: string;
  isRefunded?: boolean;
  purpose?: string;
}

export function staticMerchantReferenceId(packageId: string, uid: string): string {
  return `${packageId}${uid.slice(-4)}`;
}

export function toPaymentRef(doc: LeanPayment): PaymentRef | null {
  if (!doc.uid || !doc.paymentTime) return null;
  return {
    id: String(doc._id),
    uid: String(doc.uid),
    pkgId: doc.pkgId ? String(doc.pkgId) : "",
    paymentTime: new Date(doc.paymentTime),
    paymentMethod: doc.paymentMethod ?? "",
    merchantReferenceId: doc.merchantReferenceId ?? "",
    isRefunded: doc.isRefunded === true,
    purpose: doc.purpose ?? "",
  };
}

function paymentMatchesPackage(payment: PaymentRef, pkg: PackageRef): boolean {
  if (payment.purpose && payment.purpose !== "PACKAGE") return false;
  if (payment.pkgId && payment.pkgId === pkg.packageId) return true;
  return (
    payment.merchantReferenceId !== "" &&
    payment.merchantReferenceId === pkg.staticMerchantReferenceId
  );
}

export function findRecycledPayment(
  payments: PaymentRef[],
  pkg: PackageRef,
): { payment: PaymentRef; gapReference: "packageCreatedAt" | "pkgStartDate" } | null {
  const nearby = payments.some((payment) => {
    if (!paymentMatchesPackage(payment, pkg)) return false;
    return Math.abs(payment.paymentTime.getTime() - pkg.pkgStartDate.getTime()) <= MATCH_WINDOW_MS;
  });
  if (nearby) return null;

  const reference = pkg.packageCreatedAt ?? pkg.pkgStartDate;
  const gapReference = pkg.packageCreatedAt ? "packageCreatedAt" : "pkgStartDate";
  const older = payments
    .filter((payment) => {
      if (payment.isRefunded) return false;
      if (payment.paymentMethod !== "APP") return false;
      if (payment.purpose && payment.purpose !== "PACKAGE") return false;
      if (payment.merchantReferenceId !== pkg.staticMerchantReferenceId) return false;
      return payment.paymentTime.getTime() < reference.getTime() - HOUR_MS;
    })
    .sort((a, b) => a.paymentTime.getTime() - b.paymentTime.getTime());

  const payment = older[0];
  if (!payment) return null;
  return { payment, gapReference };
}

async function connect(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not defined in prod.env");
  }
  await mongoose.connect(uri);
}

export async function loadPackagePayments(uids: string[]): Promise<Map<string, PaymentRef[]>> {
  const byUid = new Map<string, PaymentRef[]>();
  if (uids.length === 0) return byUid;

  const docs = (await Payment.find({
    uid: { $in: uids.map((id) => new Types.ObjectId(id)) },
    purpose: "PACKAGE",
  })
    .select("uid pkgId paymentTime paymentMethod merchantReferenceId isRefunded purpose")
    .lean()) as unknown as LeanPayment[];

  for (const doc of docs) {
    const payment = toPaymentRef(doc);
    if (!payment) continue;
    const list = byUid.get(payment.uid);
    if (list) list.push(payment);
    else byUid.set(payment.uid, [payment]);
  }
  return byUid;
}

export async function auditPaymentIdempotency(): Promise<DatabaseAudit> {
  const members = await Member.find(
    { "packages.pkgStartDate": { $gte: AUDIT_WINDOW_START } },
    { uid: 1, packages: 1 },
  ).lean();

  const packages: PackageRef[] = [];
  for (const member of members) {
    const uid = String(member.uid);
    for (const raw of (member.packages ?? []) as LeanPackage[]) {
      if (!raw.pkgId || !raw.pkgStartDate) continue;
      const pkgStartDate = new Date(raw.pkgStartDate);
      if (pkgStartDate.getTime() < AUDIT_WINDOW_START.getTime()) continue;
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
        pkgStartDate,
        packageCreatedAt,
        status: raw.status ?? "",
        remainingClasses: typeof raw.remainingClasses === "number" ? raw.remainingClasses : 0,
        staticMerchantReferenceId: staticMerchantReferenceId(packageId, uid),
      });
    }
  }

  const uids = [...new Set(packages.map((pkg) => pkg.uid))];
  const paymentsByUid = await loadPackagePayments(uids);

  const userDocs = await User.find({ _id: { $in: uids } })
    .select("name phoneNumber")
    .lean();
  const users = new Map(
    userDocs.map((user) => [
      String(user._id),
      { name: user.name ?? "", phone: user.phoneNumber ?? "" },
    ]),
  );

  const rows: DbAuditRow[] = [];
  for (const pkg of packages) {
    const found = findRecycledPayment(paymentsByUid.get(pkg.uid) ?? [], pkg);
    if (!found) continue;
    const user = users.get(pkg.uid);
    const reference = pkg.packageCreatedAt ?? pkg.pkgStartDate;
    rows.push({
      uid: pkg.uid,
      userName: user?.name ?? "",
      userPhone: user?.phone ?? "",
      packageName: pkg.packageName,
      packageId: pkg.packageId,
      packageSubdocId: pkg.packageSubdocId,
      pkgStartDate: pkg.pkgStartDate.toISOString(),
      packageCreatedAt: pkg.packageCreatedAt ? pkg.packageCreatedAt.toISOString() : null,
      status: pkg.status,
      remainingClasses: pkg.remainingClasses,
      recycledPaymentId: found.payment.id,
      recycledPaymentDate: found.payment.paymentTime.toISOString(),
      recycledPaymentMref: found.payment.merchantReferenceId,
      paymentGapHours: Number(
        ((reference.getTime() - found.payment.paymentTime.getTime()) / HOUR_MS).toFixed(2),
      ),
      gapReference: found.gapReference,
    });
  }

  rows.sort((a, b) => {
    const byDate = b.pkgStartDate.localeCompare(a.pkgStartDate);
    if (byDate !== 0) return byDate;
    return a.userName.localeCompare(b.userName);
  });

  return {
    scannedMembers: members.length,
    scannedPackages: packages.length,
    rows,
    packages,
    paymentsByUid,
  };
}

async function main(): Promise<void> {
  await connect();
  try {
    const audit = await auditPaymentIdempotency();
    const outPath = path.join(__dirname, "payment-audit-results.json");
    const payload = {
      generatedAt: new Date().toISOString(),
      windowStart: AUDIT_WINDOW_START.toISOString(),
      scannedMembers: audit.scannedMembers,
      scannedPackages: audit.scannedPackages,
      count: audit.rows.length,
      incidents: audit.rows,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(
      `Method 1: ${audit.rows.length} recycled-payment candidates ` +
        `(${audit.scannedPackages} packages on ${audit.scannedMembers} members since ${AUDIT_WINDOW_START.toISOString()}).`,
    );
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
