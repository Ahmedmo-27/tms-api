/**
 * recover-jul28-dropin-payment-failures.ts
 *
 * Incident recovery (2026-07-28 prod logs): Geidea charged drop-in (and one
 * package) users, then POST /member/dropIn failed with
 * `Path locationId is required`, so payment + booking were never saved.
 *
 * Cases covered:
 *   - Sarah  : 2×450 EGP → fulfill 1 drop-in; record duplicate as refunded
 *   - Aliah  : 1×450 EGP → fulfill drop-in
 *   - Hana   : 1×450 EGP → fulfill drop-in
 *   - Ganna  : INVALID_PAYMENT / Geidea orders=[] → skip (not charged)
 *   - Sally  : 3825 EGP package → verify / recover package+payment if missing
 *
 * Usage (do not run against prod until reviewed):
 *   npx ts-node src/scripts/recover-jul28-dropin-payment-failures.ts
 *   npx ts-node src/scripts/recover-jul28-dropin-payment-failures.ts --execute
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose, { Types, ClientSession } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package, { getPackageEndDate } from "../models/package";
import Payment, { IPayment } from "../models/payment";
import ScheduledClass from "../models/scheduledClass";
import Location from "../models/location";
import { runInTransaction } from "../utils/transaction";
import { PaymentsService } from "../services/payments-service";
import { resolveSessionPaymentLocationId } from "../utils/app-package-location";
import { sendPaymentToRentalSystem } from "../services/egygap-erp-service";

// ---------------------------------------------------------------------------
// Incident constants (from Railway prod logs 2026-07-27 → 2026-07-28)
// ---------------------------------------------------------------------------

const KNOWN_CAIRO_LOCATION_ID = "69ec4abad8394559ce7ca77c";

const SARAH = {
  email: "sarah_azaher@hotmail.com",
  uid: "69e79bb354d83d654933492d",
  scId: "6a64e3f491561ae20ce13544",
  merchantReferenceId: "6a64e3f491561ae20ce13544492d",
  amount: 450,
  /** First Geidea Paid order — use this for the fulfilled drop-in */
  fulfillOrderId: "6e2e94e4-9a4a-4322-17b1-08dee7757a77",
  /** Second Geidea Paid order under the same merchantReferenceId — refund */
  duplicateOrderId: "a2758f5e-6e36-442a-0ee4-08dee7752bef",
  paymentTime: "2026-07-28T04:20:10.000Z",
  duplicatePaymentTime: "2026-07-28T04:21:15.000Z",
};

const ALIAH = {
  email: "aliah_elhadidy@yahoo.com",
  uid: "69e9424413c8a3201048ab17",
  scId: "6a64e41391561ae20ce17740",
  merchantReferenceId: "6a64e41391561ae20ce17740ab17",
  amount: 450,
  orderId: "c1c5690f-0965-4279-17df-08dee7757a77",
  paymentTime: "2026-07-28T05:37:58.000Z",
};

const HANA = {
  email: "hanahesham@live.com",
  uid: "69edb9e713c8a320104cc22f",
  scId: "6a64e44291561ae20ce1fb36",
  merchantReferenceId: "6a64e44291561ae20ce1fb36c22f",
  amount: 450,
  orderId: "27f995ef-7e9f-441d-185d-08dee7757a77",
  paymentTime: "2026-07-28T07:28:42.000Z",
};

const GANNA = {
  email: "gannaelgohary07@gmail.com",
  uid: "69e796f954d83d65493337d1",
  scId: "6a64e08791561ae20cdadb72",
  merchantReferenceId: "6a64e08791561ae20cdadb7237d1",
};

const SALLY = {
  email: "sally.morshed@aucegypt.edu",
  uid: "69e7961b54d83d65493335bb",
  pkgId: "6a4e48e5b71a5d31d783801d",
  merchantReferenceId: "6a4e48e5b71a5d31d783801d35bb",
  amount: 3825,
  orderId: "4fd96f2f-47d5-4a9e-0f7c-08dee7752bef",
  /** Cairo midnight on charge day */
  pkgStartDate: "2026-07-28T00:00:00.000+03:00",
};

const NOTE_FULFILL =
  "Recovery 2026-07-28: Geidea Paid but dropIn failed (missing locationId)";
const NOTE_DUPLICATE_REFUND =
  "Recovery 2026-07-28: Duplicate Geidea charge — refund on Geidea; do not book";

function isDryRun(): boolean {
  return !process.argv.includes("--execute");
}

function logSection(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

async function assertUserAndMember(uid: string, expectedEmail: string) {
  const user = await User.findById(uid);
  if (!user) throw new Error(`User not found: ${uid}`);
  if (
    user.email &&
    user.email.toLowerCase() !== expectedEmail.toLowerCase()
  ) {
    throw new Error(
      `Email mismatch for ${uid}: expected ${expectedEmail}, got ${user.email}`,
    );
  }
  const member = await Member.findOne({ uid: new Types.ObjectId(uid) });
  if (!member) throw new Error(`Member not found for uid ${uid}`);
  return { user, member };
}

async function resolveDropInLocationId(scId: string): Promise<string> {
  const scheduledClass = await ScheduledClass.findById(scId).populate({
    path: "cid",
  });
  if (!scheduledClass) throw new Error(`ScheduledClass not found: ${scId}`);
  return resolveSessionPaymentLocationId(scheduledClass as any);
}

/**
 * Book member onto class. If already booked, no-op.
 * If class has 0 slots, force-book (paid recovery takes priority) with a warning.
 */
async function bookMemberForRecovery(
  scId: string,
  uid: string,
  session: ClientSession,
): Promise<"booked" | "already" | "forced"> {
  const sc = await ScheduledClass.findById(scId).session(session);
  if (!sc) throw new Error(`ScheduledClass not found: ${scId}`);

  const already = sc.bookedMembers?.some(
    (m: any) => m.uid.toString() === uid,
  );
  if (already) return "already";

  try {
    await ScheduledClass.bookMember(scId, uid, "Drop In", session);
    return "booked";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    const isFull =
      code === "CLASS_FULLY_BOOKED" ||
      /fully booked/i.test(msg) ||
      /CLASS_FULLY_BOOKED/i.test(msg);
    if (!isFull) throw err;
    console.warn(
      `  [WARN] Class ${scId} has no available slots — force-booking paid member`,
    );
    await ScheduledClass.updateOne(
      { _id: new Types.ObjectId(scId) },
      {
        $push: {
          bookedMembers: {
            uid: new Types.ObjectId(uid),
            method: "Drop In",
          },
        },
        $inc: { availableSlots: -1 },
      },
      { session },
    );
    return "forced";
  }
}

async function findPaymentByOrderId(orderId: string) {
  return Payment.findOne({ orderId });
}

async function findPaymentByMerchantRef(merchantReferenceId: string) {
  return Payment.findOne({ merchantReferenceId });
}

async function recoverDropIn(opts: {
  dryRun: boolean;
  label: string;
  uid: string;
  email: string;
  scId: string;
  merchantReferenceId: string;
  orderId: string;
  amount: number;
  paymentTime: string;
  syncErp: boolean;
}): Promise<void> {
  const { user } = await assertUserAndMember(opts.uid, opts.email);
  console.log(`User: ${user.name} | ${user.email}`);

  const locationId = await resolveDropInLocationId(opts.scId);
  console.log(`Resolved locationId: ${locationId}`);

  const byOrder = await findPaymentByOrderId(opts.orderId);
  if (byOrder) {
    console.log(
      `[SKIP] Payment already exists for orderId ${opts.orderId}: ${byOrder._id}`,
    );
  }

  const member = await Member.findOne({ uid: new Types.ObjectId(opts.uid) });
  const alreadyBooked = member?.bookings?.some(
    (b) => b.scid.toString() === opts.scId,
  );
  if (alreadyBooked) {
    console.log(`[SKIP] Member already has booking for scId ${opts.scId}`);
  }

  const sc = await ScheduledClass.findById(opts.scId).populate("cid");
  if (!sc) throw new Error(`ScheduledClass not found: ${opts.scId}`);
  const classPrice = (sc.cid as any)?.price;
  if (classPrice != null && classPrice !== opts.amount) {
    console.warn(
      `  [WARN] Class price ${classPrice} != charged amount ${opts.amount} — using charged amount`,
    );
  }

  console.log("Will create / ensure:");
  console.log(
    `  Payment: APP / DROPIN / ${opts.amount} EGP / orderId=${opts.orderId}`,
  );
  console.log(`  merchantReferenceId: ${opts.merchantReferenceId}`);
  console.log(`  Member booking (isDropIn) on scId ${opts.scId}`);
  console.log(`  ScheduledClass bookedMembers entry`);
  console.log(`  ERP sync: ${opts.syncErp ? "yes" : "no"}`);

  if (opts.dryRun) {
    console.log("[DRY RUN] No writes for this part.");
    return;
  }

  if (byOrder && alreadyBooked) {
    console.log("[OK] Already recovered — nothing to do.");
    return;
  }

  await runInTransaction(async (session) => {
    let payment: IPayment | null = byOrder;
    if (!payment) {
      payment = await PaymentsService.savePayment(
        opts.uid,
        opts.amount,
        "APP",
        "DROPIN",
        session,
        opts.orderId,
        opts.merchantReferenceId,
        new Types.ObjectId(opts.scId),
        undefined,
        opts.paymentTime,
        NOTE_FULFILL,
        undefined,
        undefined,
        locationId,
      );
      console.log(`[OK] Payment saved: ${payment._id}`);
    } else {
      console.log(`[OK] Reusing existing payment: ${payment._id}`);
    }

    if (!alreadyBooked) {
      await Member.saveDropIn(
        opts.uid,
        opts.scId,
        (payment._id as Types.ObjectId).toString(),
        session,
      );
      console.log(`[OK] Member drop-in booking saved`);
    }

    const bookResult = await bookMemberForRecovery(
      opts.scId,
      opts.uid,
      session,
    );
    console.log(`[OK] Class book result: ${bookResult}`);

    if (opts.syncErp && !byOrder) {
      try {
        await sendPaymentToRentalSystem(payment);
        console.log(`[OK] ERP sync attempted for payment ${payment._id}`);
      } catch (erpErr) {
        console.error(
          `[WARN] ERP sync failed (payment/booking still saved):`,
          erpErr,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = isDryRun();
  console.log(
    dryRun
      ? "=== DRY RUN (pass --execute to write) ==="
      : "=== EXECUTE — WRITING TO PROD DB ===",
  );

  await connectDB();

  const cairo = await resolveCairoLocationId();
  console.log(
    `Cairo fallback branch: ${cairo.branchName} — ${cairo.location} (${cairo.id})`,
  );

  // =========================================================================
  // PART 1 — Sarah Azaher: fulfill FIRST 450 EGP drop-in charge
  // Geidea Paid order 6e2e94e4-… then dropIn failed on missing locationId.
  // Account should get: 1 DROPIN payment + 1 class booking.
  // =========================================================================
  logSection(
    "PART 1 — Sarah Azaher: fulfill first drop-in (450 EGP / order 6e2e94e4-…)",
  );
  await recoverDropIn({
    dryRun,
    label: "Sarah fulfill",
    uid: SARAH.uid,
    email: SARAH.email,
    scId: SARAH.scId,
    merchantReferenceId: SARAH.merchantReferenceId,
    orderId: SARAH.fulfillOrderId,
    amount: SARAH.amount,
    paymentTime: SARAH.paymentTime,
    syncErp: true,
  });

  // =========================================================================
  // PART 2 — Sarah Azaher: record DUPLICATE 450 EGP charge as refunded
  // Same merchantReferenceId charged a second time (order a2758f5e-…).
  // Do NOT book again. Create an isRefunded payment for audit, and refund
  // manually on Geidea for that orderId.
  // =========================================================================
  logSection(
    "PART 2 — Sarah Azaher: duplicate charge → refunded payment record (450 EGP)",
  );
  {
    await assertUserAndMember(SARAH.uid, SARAH.email);
    const locationId = await resolveDropInLocationId(SARAH.scId);
    const existing = await findPaymentByOrderId(SARAH.duplicateOrderId);

    console.log("Will create:");
    console.log(
      `  Payment: APP / DROPIN / ${SARAH.amount} EGP / isRefunded=true`,
    );
    console.log(`  orderId: ${SARAH.duplicateOrderId}`);
    console.log(
      `  MANUAL GEIDEA REFUND REQUIRED for order ${SARAH.duplicateOrderId}`,
    );
    console.log(`  No booking for this charge.`);

    if (existing) {
      console.log(
        `[SKIP] Payment already exists for duplicate orderId: ${existing._id} (refunded=${existing.isRefunded})`,
      );
    } else if (dryRun) {
      console.log("[DRY RUN] No writes for this part.");
    } else {
      await runInTransaction(async (session) => {
        const payment = await PaymentsService.savePayment(
          SARAH.uid,
          SARAH.amount,
          "APP",
          "DROPIN",
          session,
          SARAH.duplicateOrderId,
          SARAH.merchantReferenceId,
          new Types.ObjectId(SARAH.scId),
          undefined,
          SARAH.duplicatePaymentTime,
          NOTE_DUPLICATE_REFUND,
          undefined,
          undefined,
          locationId,
        );
        await Payment.findByIdAndUpdate(
          payment._id,
          {
            $set: {
              isRefunded: true,
              refundReason:
                "Duplicate Geidea charge after failed dropIn confirm — refund on Geidea gateway",
            },
          },
          { session },
        );
        console.log(
          `[OK] Refunded audit payment saved: ${payment._id} (do NOT treat as revenue)`,
        );
        console.log(
          `[ACTION] Refund 450 EGP on Geidea for orderId ${SARAH.duplicateOrderId}`,
        );
      });
    }
  }

  // =========================================================================
  // PART 3 — Aliah Elhadidy: fulfill 450 EGP drop-in
  // =========================================================================
  logSection(
    "PART 3 — Aliah Elhadidy: fulfill drop-in (450 EGP / order c1c5690f-…)",
  );
  await recoverDropIn({
    dryRun,
    label: "Aliah fulfill",
    uid: ALIAH.uid,
    email: ALIAH.email,
    scId: ALIAH.scId,
    merchantReferenceId: ALIAH.merchantReferenceId,
    orderId: ALIAH.orderId,
    amount: ALIAH.amount,
    paymentTime: ALIAH.paymentTime,
    syncErp: true,
  });

  // =========================================================================
  // PART 4 — Hana Hesham: fulfill 450 EGP drop-in
  // =========================================================================
  logSection(
    "PART 4 — Hana Hesham: fulfill drop-in (450 EGP / order 27f995ef-…)",
  );
  await recoverDropIn({
    dryRun,
    label: "Hana fulfill",
    uid: HANA.uid,
    email: HANA.email,
    scId: HANA.scId,
    merchantReferenceId: HANA.merchantReferenceId,
    orderId: HANA.orderId,
    amount: HANA.amount,
    paymentTime: HANA.paymentTime,
    syncErp: true,
  });

  // =========================================================================
  // PART 5 — Ganna Elgohary: SKIP — Geidea returned orders=[] / INVALID_PAYMENT
  // She was never charged; nothing to recover or refund.
  // =========================================================================
  logSection(
    "PART 5 — Ganna Elgohary: SKIP (not charged — Geidea orders empty)",
  );
  {
    console.log(`User: ${GANNA.email} (${GANNA.uid})`);
    console.log(`scId attempted: ${GANNA.scId}`);
    console.log(`merchantReferenceId: ${GANNA.merchantReferenceId}`);
    console.log(
      "[SKIP] No Geidea Paid order — do not create payment or booking.",
    );
    console.log(
      "[INFO] She can retry drop-in after paying; no refund owed.",
    );
  }

  // =========================================================================
  // PART 6 — Sally Morshed: verify / recover 3825 EGP package purchase
  // Logs show Geidea Paid + ERPNext send. If payment/package missing in DB,
  // attach them. If already present, report only (booking eligibility is
  // separate from this payment failure).
  // =========================================================================
  logSection(
    "PART 6 — Sally Morshed: verify/recover package (3825 EGP / order 4fd96f2f-…)",
  );
  {
    const { user, member } = await assertUserAndMember(SALLY.uid, SALLY.email);
    console.log(`User: ${user.name} | ${user.email}`);

    const pkg = await Package.findById(SALLY.pkgId);
    if (!pkg) throw new Error(`Package not found: ${SALLY.pkgId}`);
    console.log(
      `Package: ${pkg.name} | ${pkg.numberOfSessions} sessions | ${pkg.price} EGP`,
    );

    const existingPayment =
      (await findPaymentByOrderId(SALLY.orderId)) ||
      (await findPaymentByMerchantRef(SALLY.merchantReferenceId));

    const startDate = new Date(SALLY.pkgStartDate);
    const endDate = getPackageEndDate(startDate, pkg);
    const hasPkg = member.packages.some(
      (p) =>
        p.pkgId.toString() === SALLY.pkgId &&
        p.status !== "DELETED" &&
        p.pkgStartDate.toDateString() === startDate.toDateString(),
    );

    console.log(
      `Existing payment: ${existingPayment ? String(existingPayment._id) : "NONE"}`,
    );
    console.log(`Package on member for start day: ${hasPkg ? "YES" : "NO"}`);

    if (existingPayment && hasPkg) {
      console.log(
        "[OK] Package + payment already on account — no recovery write needed.",
      );
      console.log(
        "[INFO] If she still can't book, check package category / class eligibility separately.",
      );
    } else {
      const locationId =
        (pkg.locationId && String(pkg.locationId)) || cairo.id;
      console.log("Will create missing pieces:");
      if (!existingPayment) {
        console.log(
          `  Payment: APP / PACKAGE / ${SALLY.amount} EGP / locationId=${locationId}`,
        );
      }
      if (!hasPkg) {
        console.log(
          `  Member package: ${pkg.name} | ${startDate.toISOString()} → ${endDate.toISOString()}`,
        );
      }

      if (dryRun) {
        console.log("[DRY RUN] No writes for this part.");
      } else {
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
          let payment: IPayment | null = existingPayment;
          if (!payment) {
            payment = await PaymentsService.savePayment(
              SALLY.uid,
              SALLY.amount,
              "APP",
              "PACKAGE",
              session,
              SALLY.orderId,
              SALLY.merchantReferenceId,
              undefined,
              new Types.ObjectId(SALLY.pkgId),
              startDate.toISOString(),
              "Recovery 2026-07-28: verify package after Geidea+ERP (locationId incident window)",
              undefined,
              undefined,
              locationId,
            );
            console.log(`[OK] Package payment saved: ${payment._id}`);
            // ERP was already sent per logs — do not double-send unless missing.
            console.log(
              "[INFO] Skipping ERP sync (logs already showed ERPNext send for this purchase).",
            );
          }

          if (!hasPkg) {
            await Member.addPackage(
              SALLY.uid,
              pkg._id.toString(),
              pkg.name,
              pkg.numberOfSessions,
              startDate.toISOString(),
              endDate.toISOString(),
              session,
              restrictions,
              locationId,
            );
            console.log(`[OK] Package added to member`);
          }
        });
      }
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  logSection("SUMMARY");
  console.log(
    dryRun
      ? "Dry run finished — re-run with --execute to apply writes."
      : "Execute finished — verify accounts in DB / admin dashboard.",
  );
  console.log(`
Expected end state:
  • Sarah  : 1 active drop-in booking + 1 paid DROPIN + 1 refunded DROPIN (manual Geidea refund)
  • Aliah  : 1 active drop-in booking + 1 paid DROPIN
  • Hana   : 1 active drop-in booking + 1 paid DROPIN
  • Ganna  : unchanged (not charged)
  • Sally  : package + payment present (recovered only if missing)
`);

  await mongoose.disconnect();
  console.log("Done.");
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
