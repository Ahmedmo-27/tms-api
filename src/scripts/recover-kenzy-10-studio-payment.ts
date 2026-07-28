/**
 * recover-kenzy-10-studio-payment.ts
 *
 * Incident recovery (2026-07-27): Geidea charged Kenzy for 10 Studio, then
 * POST /member/packages failed with "Path `locationId` is required", so the
 * package and payment were never saved.
 *
 * This script adds the package + payment record on the Cairo branch.
 *
 * Usage:
 *   npx ts-node src/scripts/recover-kenzy-10-studio-payment.ts --dry-run
 *   npx ts-node src/scripts/recover-kenzy-10-studio-payment.ts --execute
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package, { getPackageEndDate } from "../models/package";
import Payment from "../models/payment";
import Location from "../models/location";
import { runInTransaction } from "../utils/transaction";
import { PaymentsService } from "../services/payments-service";

const UID = "69efeb7313c8a32010570a8b";
const PKG_ID = "69e53352408d558187798185";
const MERCHANT_REFERENCE_ID = "69e53352408d5581877981850a8b";
/** Known Cairo location id from prod (repair scripts). Looked up by name as fallback. */
const KNOWN_CAIRO_LOCATION_ID = "69ec4abad8394559ce7ca77c";
/** Package start = Cairo midnight on the charge day (matches admin retry attempts). */
const PKG_START_DATE = "2026-07-27T00:00:00.000+03:00";

function isDryRun(): boolean {
  return !process.argv.includes("--execute");
}

async function resolveCairoLocationId(): Promise<{
  id: string;
  branchName: string;
  location: string;
}> {
  const byId = await Location.findById(KNOWN_CAIRO_LOCATION_ID);
  if (byId) {
    return {
      id: String(byId._id),
      branchName: byId.branchName,
      location: byId.location,
    };
  }

  const byName = await Location.findOne({
    $or: [
      { branchName: /cairo/i },
      { location: /cairo/i },
      { branchName: /mind\s*space/i },
    ],
  });
  if (!byName) {
    throw new Error(
      "Could not find Cairo / Mind Space location in the Location collection",
    );
  }
  return {
    id: String(byName._id),
    branchName: byName.branchName,
    location: byName.location,
  };
}

async function main() {
  const dryRun = isDryRun();
  console.log(dryRun ? "=== DRY RUN (pass --execute to write) ===" : "=== EXECUTE ===");

  await connectDB();

  const cairo = await resolveCairoLocationId();
  console.log(`Cairo branch: ${cairo.branchName} — ${cairo.location} (${cairo.id})`);

  const user = await User.findById(UID);
  if (!user) throw new Error(`User not found: ${UID}`);
  console.log(`User: ${user.name} | ${user.email} | role=${user.role}`);

  const member = await Member.findOne({ uid: new Types.ObjectId(UID) });
  if (!member) throw new Error(`Member not found for uid ${UID}`);

  const pkg = await Package.findById(PKG_ID);
  if (!pkg) throw new Error(`Package not found: ${PKG_ID}`);
  console.log(
    `Package: ${pkg.name} | ${pkg.numberOfSessions} sessions | ${pkg.price} EGP | expiry ${pkg.expiryPeriod}d`,
  );

  const existingPayment = await Payment.findOne({
    merchantReferenceId: MERCHANT_REFERENCE_ID,
  });
  if (existingPayment) {
    console.log(
      `\n[ABORT] Payment already exists for merchantReferenceId ${MERCHANT_REFERENCE_ID}:`,
      String(existingPayment._id),
    );
    await mongoose.disconnect();
    return;
  }

  const startDate = new Date(PKG_START_DATE);
  const endDate = getPackageEndDate(startDate, pkg);
  const alreadyHasPkg = member.packages.some(
    (p) =>
      p.pkgId.toString() === PKG_ID &&
      p.status !== "DELETED" &&
      p.pkgStartDate.toDateString() === startDate.toDateString(),
  );
  if (alreadyHasPkg) {
    console.log(
      `\n[ABORT] Member already has this package starting ${startDate.toISOString()}`,
    );
    await mongoose.disconnect();
    return;
  }

  console.log("\nWill create:");
  console.log(`  Payment: APP / PACKAGE / ${pkg.price} EGP / locationId=${cairo.id}`);
  console.log(`  merchantReferenceId: ${MERCHANT_REFERENCE_ID}`);
  console.log(
    `  Member package: ${pkg.name} | ${startDate.toISOString()} → ${endDate.toISOString()} | ${pkg.numberOfSessions} classes`,
  );

  if (dryRun) {
    console.log("\nDry run complete — no writes. Re-run with --execute to apply.");
    await mongoose.disconnect();
    return;
  }

  let restrictions:
    | { cid: Types.ObjectId; limit: number }[]
    | undefined;
  if (pkg.classRestrictions?.length) {
    restrictions = pkg.classRestrictions.map((cls) => ({
      cid: cls.cid,
      limit: cls.limit,
    }));
  }

  await runInTransaction(async (session) => {
    const payment = await PaymentsService.savePayment(
      UID,
      pkg.price,
      "APP",
      "PACKAGE",
      session,
      undefined,
      MERCHANT_REFERENCE_ID,
      undefined,
      new Types.ObjectId(PKG_ID),
      startDate.toISOString(),
      "Recovery: Geidea paid but confirm failed (missing locationId) 2026-07-27",
      undefined,
      undefined,
      cairo.id,
    );

    await Member.addPackage(
      UID,
      pkg._id.toString(),
      pkg.name,
      pkg.numberOfSessions,
      startDate.toISOString(),
      endDate.toISOString(),
      session,
      restrictions,
      cairo.id,
    );

    console.log(`\n[OK] Payment saved: ${payment._id}`);
    console.log(`[OK] Package added to member`);
  });

  const updated = await Member.findOne({ uid: new Types.ObjectId(UID) });
  const added = updated?.packages.filter((p) => p.pkgId.toString() === PKG_ID);
  console.log("\nMember packages matching 10 Studio:");
  console.log(JSON.stringify(added, null, 2));

  const payments = await Payment.find({
    uid: new Types.ObjectId(UID),
    pkgId: new Types.ObjectId(PKG_ID),
  }).sort({ paymentTime: -1 });
  console.log("\nRelated payments:");
  console.log(
    JSON.stringify(
      payments.map((p) => ({
        _id: p._id,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        merchantReferenceId: p.merchantReferenceId,
        locationId: p.locationId,
        paymentTime: p.paymentTime,
        note: p.note,
      })),
      null,
      2,
    ),
  );

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch(async (err) => {
  console.error("Failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
