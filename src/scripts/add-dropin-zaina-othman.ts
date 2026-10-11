/**
 * add-dropin-zaina-othman.ts
 *
 * Manually adds a drop-in booking + DROPIN payment record for Zaina Othman
 * on the class scheduled for 2026-09-23 07:30 Cairo time.
 *
 * Member:  Zaina Othman  |  01095157137  |  zainaa.othman4@gmail.com
 * Class:   6aae9c999a032363e1dae169  (startTime 2026-09-23T04:30:00Z = 07:30 Cairo)
 * Location: 69ec4abad8394559ce7ca77c  (Cairo branch)
 *
 * Usage:
 *   npx ts-node src/scripts/add-dropin-zaina-othman.ts --dry-run
 *   npx ts-node src/scripts/add-dropin-zaina-othman.ts --execute
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Payment from "../models/payment";
import ScheduledClass from "../models/scheduledClass";
import { runInTransaction } from "../utils/transaction";
import { PaymentsService } from "../services/payments-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const SCID         = "6aae9c999a032363e1dae169"; // Scheduled class ID
const LOCATION_ID  = "69ec4abad8394559ce7ca77c"; // Cairo branch
const MEMBER_PHONE = "01095157137";
const MEMBER_EMAIL = "zainaa.othman4@gmail.com";

// Payment details – adjust amount / method as required
const PAYMENT_METHOD = "APP" as const; // CASH | VISA | INSTAPAY | VALU | PAYMENT_LINK | APP
const PAYMENT_DATE   = "2026-09-23T07:30:00.000+03:00"; // Cairo class start time
const NOTE           = "Manual drop-in booking – admin recovery 2026-09-23";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDryRun(): boolean {
  return !process.argv.includes("--execute");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = isDryRun();
  console.log(
    dryRun
      ? "=== DRY RUN (pass --execute to write) ==="
      : "=== EXECUTE ==="
  );

  await connectDB();

  // ── 1. Look up the scheduled class ──────────────────────────────────────
  const scheduledClass: any = await ScheduledClass.findById(SCID).populate("cid");
  if (!scheduledClass)
    throw new Error(`ScheduledClass not found: ${SCID}`);

  const classTitle  = scheduledClass.cid?.title ?? "Unknown class";
  const classPrice  = scheduledClass.cid?.price ?? 0;
  const startTimeUTC = scheduledClass.startTime as Date;
  const startTimeCairo = startTimeUTC.toLocaleString("en-EG", {
    timeZone: "Africa/Cairo",
  });

  console.log(`\nClass: ${classTitle}`);
  console.log(`  SCID:      ${SCID}`);
  console.log(`  Start:     ${startTimeCairo} (Cairo) / ${startTimeUTC.toISOString()} (UTC)`);
  console.log(`  Slots left: ${scheduledClass.availableSlots}`);
  console.log(`  Price:     ${classPrice} EGP`);

  // ── 2. Find user by phone or email ──────────────────────────────────────
  const user = await User.findOne({
    $or: [{ phoneNumber: MEMBER_PHONE }, { email: MEMBER_EMAIL }],
  });
  if (!user) throw new Error(`User not found – phone: ${MEMBER_PHONE} / email: ${MEMBER_EMAIL}`);
  const uid = (user._id as Types.ObjectId).toString();
  console.log(`\nUser: ${user.name} | ${user.email} | ${user.phoneNumber} | uid=${uid}`);

  // ── 3. Look up the member record ─────────────────────────────────────────
  const member = await Member.findOne({ uid: new Types.ObjectId(uid) });
  if (!member) throw new Error(`Member record not found for uid ${uid}`);

  // ── 4. Guard: already booked? ────────────────────────────────────────────
  const alreadyBookedOnClass = scheduledClass.bookedMembers?.some(
    (m: any) => m.uid.toString() === uid
  );
  if (alreadyBookedOnClass) {
    console.log("\n[ABORT] Member is already in scheduledClass.bookedMembers – nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const alreadyBookedOnMember = member.bookings?.find(
    (b: any) => b.scid.toString() === SCID
  );
  if (alreadyBookedOnMember) {
    console.log("\n[ABORT] Member already has a booking record for this class – nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // ── 5. Existing drop-in payment for this class? ──────────────────────────
  const existingPayment = await Payment.findOne({
    uid: new Types.ObjectId(uid),
    scid: new Types.ObjectId(SCID),
    purpose: "DROPIN",
    isRefunded: { $ne: true },
  });
  if (existingPayment) {
    console.log(
      `\n[ABORT] A DROPIN payment already exists for this member + class: ${existingPayment._id}`
    );
    await mongoose.disconnect();
    return;
  }

  // ── 6. Summary of what will be written ───────────────────────────────────
  console.log("\nWill create:");
  console.log(`  Payment:  ${PAYMENT_METHOD} / DROPIN / ${classPrice} EGP`);
  console.log(`  paymentTime: ${PAYMENT_DATE}`);
  console.log(`  scid:     ${SCID}`);
  console.log(`  locationId: ${LOCATION_ID}`);
  console.log(`  note:     ${NOTE}`);
  console.log(`  Member booking (isDropIn=true) pushed to member.bookings`);
  console.log(`  ScheduledClass.bookedMembers entry: uid=${uid} method="Drop In"`);
  console.log(`  availableSlots decremented by 1  (current: ${scheduledClass.availableSlots})`);

  if (dryRun) {
    console.log("\nDry run complete – no writes. Re-run with --execute to apply.");
    await mongoose.disconnect();
    return;
  }

  // ── 7. Execute transaction ────────────────────────────────────────────────
  let savedPaymentId: string | undefined;

  await runInTransaction(async (session) => {
    const payment = await PaymentsService.savePayment(
      uid,
      classPrice,
      PAYMENT_METHOD,
      "DROPIN",
      session,
      undefined,           // orderId
      undefined,           // merchantReferenceId
      new Types.ObjectId(SCID), // scid
      undefined,           // pkgId
      PAYMENT_DATE,        // paymentDate
      NOTE,                // note
      undefined,           // nonMemberName
      undefined,           // nonMemberPhone
      LOCATION_ID          // locationId
    );
    savedPaymentId = (payment._id as Types.ObjectId).toString();

    await Member.saveDropIn(uid, SCID, savedPaymentId, session);

    // allowOverbooking=true so admin can book past capacity if needed
    await ScheduledClass.bookMember(SCID, uid, "Drop In", session, true);
  });

  console.log(`\n[OK] Payment saved: ${savedPaymentId}`);
  console.log(`[OK] Booking added to member.bookings (isDropIn=true)`);
  console.log(`[OK] Member pushed to scheduledClass.bookedMembers`);

  // ── 8. Verification reads ─────────────────────────────────────────────────
  const updatedClass = await ScheduledClass.findById(SCID);
  const zainaEntry = updatedClass?.bookedMembers?.find(
    (m: any) => m.uid.toString() === uid
  );
  console.log("\nScheduledClass bookedMembers entry for Zaina:");
  console.log(JSON.stringify(zainaEntry, null, 2));
  console.log(`availableSlots after: ${updatedClass?.availableSlots}`);

  const updatedMember = await Member.findOne({ uid: new Types.ObjectId(uid) });
  const memberBooking = updatedMember?.bookings?.find(
    (b: any) => b.scid.toString() === SCID
  );
  console.log("\nMember booking record:");
  console.log(JSON.stringify(memberBooking, null, 2));

  const payment = await Payment.findById(savedPaymentId);
  console.log("\nPayment record:");
  console.log(
    JSON.stringify(
      {
        _id: payment?._id,
        uid: payment?.uid,
        amount: payment?.amount,
        paymentMethod: payment?.paymentMethod,
        purpose: payment?.purpose,
        scid: payment?.scid,
        locationId: payment?.locationId,
        paymentTime: payment?.paymentTime,
        note: payment?.note,
        isRefunded: payment?.isRefunded,
      },
      null,
      2
    )
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
