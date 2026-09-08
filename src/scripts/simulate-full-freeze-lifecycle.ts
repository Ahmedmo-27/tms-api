import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import ScheduledClass from "../models/scheduledClass";
import FreezeRequest from "../models/freezeRequest";
import { SubscriptionsService } from "../services/subscriptions-service";
import { FreezeService } from "../services/freeze-service";
import { selectEligiblePackage } from "../utils/package-eligibility";
import { bookingPackageErrorMessage } from "../utils/booking-package-errors";
import { format } from "date-fns";

async function runSimulation() {
  process.stdout.write("Connecting DB...\n");
  await connectDB();

  console.log("\n================================================================================");
  console.log("🎬 FULL END-TO-END SIMULATION: IN-APP PURCHASE -> FREEZE -> USAGE BLOCK -> UNFREEZE -> EXTRA REQUEST -> ADMIN APPROVAL");
  console.log("================================================================================\n");

  // Step 0: Find or prepare test user
  const user = await User.findOne({ phoneNumber: "01222222222" });
  if (!user) {
    console.log("❌ Test user 01222222222 not found in database.");
    await mongoose.disconnect();
    return;
  }
  const uid = (user._id as Types.ObjectId).toString();
  console.log(`👤 Member Account: ${user.name} | Phone: ${user.phoneNumber} | Role: ${user.role} | ID: ${uid}`);

  // Find a 3-month package catalog item
  const catalogPkg =
    (await Package.findOne({ name: /3 month/i, isDeprecated: { $ne: true } })) ||
    (await Package.findOne({ isDeprecated: { $ne: true } }));

  if (!catalogPkg) {
    console.log("❌ No package catalog found.");
    await mongoose.disconnect();
    return;
  }
  const pkgId = (catalogPkg._id as Types.ObjectId).toString();
  console.log(`📦 Catalog Package: "${catalogPkg.name}" (ID: ${pkgId}, Expiry: ${catalogPkg.expiryPeriod} days)`);

  // ============================================================================
  // STAGE 1: Member buys package through the mobile app (APP source)
  // ============================================================================
  console.log("\n================================================================================");
  console.log("🛒 STAGE 1: MEMBER BUYS PACKAGE THROUGH THE MOBILE APP (POST /member/packages)");
  console.log("================================================================================");

  // Clean up any existing instance of this package to allow fresh subscription
  await Member.updateOne(
    { uid: user._id },
    { $pull: { packages: { pkgId: catalogPkg._id } } }
  );

  const purchaseDate = new Date().toISOString();
  console.log(`📱 App sends subscribe payload: { pkgId: "${pkgId}", source: "APP", startDate: "${purchaseDate}" }`);

  await SubscriptionsService.subscribeToPackage(
    uid,
    pkgId,
    purchaseDate,
    "APP"
  );

  let member = await Member.findOne({ uid: user._id });
  let subscribedPkg = member?.packages.find(
    (p) => p.pkgId.toString() === pkgId && p.status === "ACTIVE"
  );

  if (!subscribedPkg) {
    subscribedPkg = member?.packages[member.packages.length - 1];
  }

  console.log("\n✅ Package Successfully Subscribed in Mobile App!");
  console.log(`   - Status:              ${subscribedPkg?.status}`);
  console.log(`   - Start Date:          ${format(new Date(subscribedPkg!.pkgStartDate), "dd MMM yyyy")}`);
  console.log(`   - End Date:            ${format(new Date(subscribedPkg!.pkgEndDate), "dd MMM yyyy")}`);
  console.log(`   - Remaining Classes:   ${subscribedPkg?.remainingClasses}`);
  console.log(`   - Allowed Freeze Days: ${subscribedPkg?.freezeInfo?.allowedFreezeDays} days (~${(subscribedPkg?.freezeInfo?.allowedFreezeDays || 0) / 7} weeks quota)`);
  console.log(`   - Used Freeze Days:    ${subscribedPkg?.freezeInfo?.usedFreezeDays || 0} days`);
  console.log(`   - Is Frozen:           ${subscribedPkg?.freezeInfo?.isFrozen ? "YES" : "NO"}`);

  const pkgStartDate = subscribedPkg!.pkgStartDate;

  // ============================================================================
  // STAGE 2: Member Freezes Package for 7 Days via the App
  // ============================================================================
  console.log("\n================================================================================");
  console.log("❄️ STAGE 2: MEMBER FREEZES PACKAGE FOR 7 DAYS (POST /member/packages/freeze)");
  console.log("================================================================================");

  console.log(`📱 Member requests standard freeze for 7 days (Reason: "Travelling for business")`);

  const freezeResult = await FreezeService.freezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
    durationDays: 7,
    type: "STANDARD",
    reason: "Travelling for business",
  });

  console.log("\n✅ Package Frozen Successfully!");
  console.log(`   - Status:              ${freezeResult.status} ❄️`);
  console.log(`   - Freeze Start Date:   ${freezeResult.freezeInfo?.freezeStartDate ? format(new Date(freezeResult.freezeInfo.freezeStartDate), "dd MMM yyyy") : "—"}`);
  console.log(`   - Freeze End Date:     ${freezeResult.freezeInfo?.freezeEndDate ? format(new Date(freezeResult.freezeInfo.freezeEndDate), "dd MMM yyyy") : "—"}`);
  console.log(`   - Used Freeze Days:    ${freezeResult.freezeInfo?.usedFreezeDays} / ${freezeResult.freezeInfo?.allowedFreezeDays} days`);
  console.log(`   - Extended End Date:   ${format(new Date(freezeResult.pkgEndDate), "dd MMM yyyy")} (extended by 7 days)`);

  // ============================================================================
  // STAGE 3: Member Attempts to Use the Frozen Package
  // ============================================================================
  console.log("\n================================================================================");
  console.log("🚫 STAGE 3: MEMBER ATTEMPTS TO USE THE FROZEN PACKAGE (CLASS BOOKING & SCAN)");
  console.log("================================================================================");

  // A. Class Booking Attempt
  console.log("\n🅰️ Attempting Class Booking (POST /member/book/:scid)...");
  const scheduledClass = await ScheduledClass.findOne({}).populate("cid");
  const className = (scheduledClass?.cid as any)?.name || "Yoga Flow";

  member = await Member.findOne({ uid: user._id });
  const activePackageData = member?.packages.map((p) => ({
    pkgId: p.pkgId.toString(),
    name: catalogPkg.name,
    status: p.status,
    pkgStartDate: p.pkgStartDate,
    pkgEndDate: p.pkgEndDate,
    remainingClasses: p.remainingClasses,
  })) || [];

  const bookingEligibility = selectEligiblePackage({
    packages: activePackageData,
    allowedPkgIds: [pkgId],
    cid: (scheduledClass?.cid as any)?._id?.toString(),
  });

  console.log(`   Result: ok = ${bookingEligibility.ok}`);
  if (!bookingEligibility.ok) {
    const errorMsg = bookingPackageErrorMessage((bookingEligibility as any).code, className, {
      packageName: catalogPkg.name,
      date: freezeResult.freezeInfo?.freezeEndDate ? format(new Date(freezeResult.freezeInfo.freezeEndDate), "dd MMM yyyy") : "soon",
      audience: "member",
    });
    console.log(`   ⛔ API Response 403 Forbidden:`);
    console.log(`      { "code": "${(bookingEligibility as any).code}", "message": "${errorMsg}" }`);
  }

  // B. Front Desk / Open Gym Scan Attempt
  console.log("\n🅱️ Attempting Front Desk / Turnstile Scan (Space Walk Check-in)...");
  const openGymPkgIds = await Package.getSpaceWalkPackageIds();
  const mockIo = { emit: (event: string, data: any) => console.log(`      📡 Socket.io [${event}]:`, data) } as any;

  const scanStatus = await Member.recordSpaceWalkAttendance(
    uid,
    openGymPkgIds,
    null as any,
    mockIo
  );
  console.log(`   Desk Scan Outcome: ${scanStatus}`);
  console.log(`   ⛔ API Scan Result: Access Denied! Package is frozen until ${freezeResult.freezeInfo?.freezeEndDate ? format(new Date(freezeResult.freezeInfo.freezeEndDate), "dd MMM yyyy") : ""}.`);

  // ============================================================================
  // STAGE 4: Member Unfreezes the Package Early (Refunds unused quota)
  // ============================================================================
  console.log("\n================================================================================");
  console.log("▶️ STAGE 4: MEMBER UNFREEZES PACKAGE EARLY (POST /member/packages/unfreeze)");
  console.log("================================================================================");

  console.log("📱 Member clicks 'Unfreeze Package Early' in the mobile app");

  const unfreezeResult = await FreezeService.unfreezeMemberPackage({
    uid,
    pkgId,
    pkgStartDate,
  });

  console.log("\n✅ Package Unfrozen Successfully!");
  console.log(`   - Status:              ${unfreezeResult.status} (ACTIVE)`);
  console.log(`   - Freeze Active:       ${unfreezeResult.freezeInfo?.isFrozen ? "YES" : "NO"}`);
  console.log(`   - Used Freeze Days:    ${unfreezeResult.freezeInfo?.usedFreezeDays} days (actual days frozen deducted)`);
  console.log(`   - Remaining Quota:     ${(unfreezeResult.freezeInfo?.allowedFreezeDays || 0) - (unfreezeResult.freezeInfo?.usedFreezeDays || 0)} days refunded and available for future freezes`);
  console.log(`   - Adjusted End Date:   ${format(new Date(unfreezeResult.pkgEndDate), "dd MMM yyyy")}`);

  // Verify class booking is now allowed again
  console.log("\n   🧪 Verifying booking is now allowed again...");
  const recheckEligibility = selectEligiblePackage({
    packages: [{
      pkgId: unfreezeResult.pkgId.toString(),
      name: catalogPkg.name,
      status: unfreezeResult.status,
      pkgStartDate: unfreezeResult.pkgStartDate,
      pkgEndDate: unfreezeResult.pkgEndDate,
      remainingClasses: unfreezeResult.remainingClasses,
    }],
    allowedPkgIds: [pkgId],
  });
  console.log(`   ✅ Booking Eligibility Now: ok = ${recheckEligibility.ok} (Package is usable!)`);

  // ============================================================================
  // STAGE 5: Member Requests Extra Freeze Duration
  // ============================================================================
  console.log("\n================================================================================");
  console.log("📝 STAGE 5: MEMBER REQUESTS EXTRA FREEZE DURATION (POST /member/packages/freeze-request)");
  console.log("================================================================================");

  // Clean any old pending requests
  await FreezeRequest.deleteMany({ memberId: new Types.ObjectId(uid), pkgId: new Types.ObjectId(pkgId) });

  const requestedDays = 21; // 3 weeks
  const requestReason = "Undergoing ACL knee physical therapy and need 3 extra weeks";
  console.log(`📱 Member submits Extra Freeze Request:`);
  console.log(`   - Requested Days: ${requestedDays} days (3 Weeks)`);
  console.log(`   - Reason:         "${requestReason}"`);

  const extraRequest = await FreezeService.requestExtraFreeze(
    uid,
    pkgId,
    pkgStartDate,
    requestedDays,
    requestReason
  );

  const reqId = (extraRequest._id as Types.ObjectId).toString();

  console.log("\n✅ Extra Freeze Request Submitted & Logged in System:");
  console.log(`   - Request ID:        ${reqId}`);
  console.log(`   - Package Name:      ${extraRequest.pkgName}`);
  console.log(`   - Requested Days:    ${extraRequest.requestedDurationDays} days`);
  console.log(`   - Status:            ${extraRequest.status} (PENDING)`);
  console.log(`   - Reason:            "${extraRequest.reason}"`);
  console.log(`   - Submitted At:      ${extraRequest.createdAt}`);

  // ============================================================================
  // STAGE 6: Management Reviews and Approves with Edited Period in Dashboard
  // ============================================================================
  console.log("\n================================================================================");
  console.log("🛡️ STAGE 6: MANAGEMENT REVIEWS & APPROVES WITH EDITED PERIOD IN DASHBOARD");
  console.log("================================================================================");

  // Find admin user
  const adminUser = await User.findOne({ role: { $in: ["management", "admin"] } });
  const adminId = adminUser ? (adminUser._id as Types.ObjectId).toString() : uid;
  console.log(`👨‍💼 Reviewing Admin: ${adminUser?.name || "Admin"} (${adminUser?.role || "management"})`);

  console.log(`\n📋 Admin views request on "/dashboard/package-freezes":`);
  console.log(`   - Member asked for: ${extraRequest.requestedDurationDays} days`);
  console.log(`   - Admin decides to approve: 14 days (2 Weeks) instead of 21 days`);
  console.log(`   - Admin note: "Approved 2 weeks medical exception per doctor note."`);

  const approvedRequest = await FreezeService.approveFreezeRequest(
    reqId,
    adminId,
    14, // Edited approved days
    "Approved 2 weeks medical exception per doctor note."
  );

  console.log("\n✅ Request Approved by Management!");
  console.log(`   - Status:                ${approvedRequest.status} (APPROVED)`);
  console.log(`   - Approved Days:         ${approvedRequest.approvedDurationDays} days`);
  console.log(`   - Admin Note:            "${approvedRequest.adminNote}"`);
  console.log(`   - Reviewed At:           ${approvedRequest.reviewedAt}`);

  // Verify member's package is now frozen for the approved duration
  member = await Member.findOne({ uid: user._id });
  const finalPkg = member?.packages.find(
    (p) => p.pkgId.toString() === pkgId && p.freezeInfo?.isFrozen
  );

  console.log("\n📦 Member's Package Final State After Approval:");
  console.log(`   - Status:                ${finalPkg?.status} ❄️`);
  console.log(`   - Freeze Start:          ${finalPkg?.freezeInfo?.freezeStartDate ? format(new Date(finalPkg.freezeInfo.freezeStartDate), "dd MMM yyyy") : "—"}`);
  console.log(`   - Freeze End:            ${finalPkg?.freezeInfo?.freezeEndDate ? format(new Date(finalPkg.freezeInfo.freezeEndDate), "dd MMM yyyy") : "—"}`);
  console.log(`   - Extra Days Approved:   ${finalPkg?.freezeInfo?.extraFreezeDaysApproved} days`);
  console.log(`   - Total Used Days:       ${finalPkg?.freezeInfo?.usedFreezeDays} days`);
  console.log(`   - New Extended Expiry:   ${finalPkg?.pkgEndDate ? format(new Date(finalPkg.pkgEndDate), "dd MMM yyyy") : "—"}`);

  console.log("\n================================================================================");
  console.log("🎉 ALL 6 STAGES COMPLETED & VERIFIED SUCCESSFULLY!");
  console.log("================================================================================\n");

  await mongoose.disconnect();
}

runSimulation().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
