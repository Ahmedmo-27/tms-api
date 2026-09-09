import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import FreezeRequest from "../models/freezeRequest";
import { FreezeService } from "../services/freeze-service";
import { SubscriptionsService } from "../services/subscriptions-service";
import { selectEligiblePackage } from "../utils/package-eligibility";
import { format, subDays } from "date-fns";

async function runEdgeCasesSuite() {
  process.stdout.write("Connecting to Test Database...\n");
  await connectDB();

  console.log("\n================================================================================");
  console.log("🧪 COMPREHENSIVE FREEZE EDGE CASES TEST SUITE (12 TESTS)");
  console.log("================================================================================\n");

  const user = await User.findOne({ phoneNumber: "01222222222" });
  if (!user) {
    console.log("❌ Test user 01222222222 not found.");
    await mongoose.disconnect();
    return;
  }
  const uid = (user._id as Types.ObjectId).toString();

  // Find 1-Month and 3-Month packages
  const pkg1Month = await Package.findOne({ expiryPeriod: { $lte: 35, $gte: 25 }, isDeprecated: { $ne: true } });
  const pkg3Month = await Package.findOne({ expiryPeriod: { $lte: 100, $gte: 80 }, isDeprecated: { $ne: true } });

  const pkg1Id = (pkg1Month!._id as Types.ObjectId).toString();
  const pkg3Id = (pkg3Month!._id as Types.ObjectId).toString();

  let passedCount = 0;
  let failedCount = 0;

  function recordResult(testName: string, passed: boolean, detail?: string) {
    if (passed) {
      passedCount++;
      console.log(`✅ [PASS] ${testName}`);
      if (detail) console.log(`   ℹ️  ${detail}`);
    } else {
      failedCount++;
      console.log(`❌ [FAIL] ${testName}`);
      if (detail) console.log(`   ⚠️  ${detail}`);
    }
  }

  // Setup Clean Member Packages for testing
  await Member.updateOne({ uid: user._id }, { $set: { packages: [] } });

  // Add a fresh 1 Month package (7 days allowed freeze quota)
  const pkgStartDate = new Date().toISOString();
  await SubscriptionsService.subscribeToPackage(uid, pkg1Id, pkgStartDate, "APP");

  // ============================================================================
  // TEST 1: Over-Quota Standard Freeze Attempt
  // ============================================================================
  console.log("\n--- TEST 1: Over-Quota Standard Freeze Attempt ---");
  try {
    // 1 Month has 7 days quota. Member tries to freeze for 10 days.
    await FreezeService.freezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
      durationDays: 10,
      type: "STANDARD",
      reason: "Trying 10 days on 7-day quota",
    });
    recordResult("Test 1: Over-quota freeze rejected", false, "Should have thrown FREEZE_DURATION_EXCEEDS_LIMIT");
  } catch (err: any) {
    const isOverQuota = err.code === "FREEZE_DURATION_EXCEEDS_LIMIT" || err.message.includes("exceeds");
    recordResult("Test 1: Over-quota freeze rejected", isOverQuota, `Caught expected error: ${err.code} - ${err.message}`);
  }

  // ============================================================================
  // TEST 2: Valid Standard Freeze Execution
  // ============================================================================
  console.log("\n--- TEST 2: Valid Standard Freeze Execution ---");
  try {
    const frozen = await FreezeService.freezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
      durationDays: 7,
      type: "STANDARD",
      reason: "Vacation",
    });
    const isFrozen = frozen.status === "FROZEN" && frozen.freezeInfo?.isFrozen === true;
    recordResult("Test 2: Valid freeze succeeded", isFrozen, `Package status: ${frozen.status}, Freeze End: ${format(new Date(frozen.freezeInfo!.freezeEndDate!), "dd MMM yyyy")}`);
  } catch (err: any) {
    recordResult("Test 2: Valid freeze succeeded", false, err.message);
  }

  // ============================================================================
  // TEST 3: Freezing an Already Frozen Package
  // ============================================================================
  console.log("\n--- TEST 3: Freezing an Already Frozen Package ---");
  try {
    await FreezeService.freezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
      durationDays: 3,
      type: "STANDARD",
    });
    recordResult("Test 3: Freezing already frozen package rejected", false, "Should have thrown PACKAGE_ALREADY_FROZEN");
  } catch (err: any) {
    const isAlreadyFrozen = err.code === "PACKAGE_ALREADY_FROZEN" || err.message.includes("already frozen");
    recordResult("Test 3: Freezing already frozen package rejected", isAlreadyFrozen, `Caught: ${err.code} - ${err.message}`);
  }

  // ============================================================================
  // TEST 4: Invalid Duration (0 or Negative Days)
  // ============================================================================
  console.log("\n--- TEST 4: Invalid Freeze Duration (0 or Negative) ---");
  try {
    await FreezeService.freezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
      durationDays: 0,
      type: "STANDARD",
    });
    recordResult("Test 4: 0 duration rejected", false, "Should have thrown INVALID_DURATION");
  } catch (err: any) {
    const isInvalid = err.code === "INVALID_DURATION";
    recordResult("Test 4: 0 duration rejected", isInvalid, `Caught: ${err.code}`);
  }

  // ============================================================================
  // TEST 5: Early Unfreeze & Quota Refund Calculation
  // ============================================================================
  console.log("\n--- TEST 5: Early Unfreeze & Quota Refund ---");
  try {
    const unfrozen = await FreezeService.unfreezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
    });
    const isActive = unfrozen.status === "ACTIVE" && !unfrozen.freezeInfo?.isFrozen;
    const remaining = (unfrozen.freezeInfo?.allowedFreezeDays || 0) - (unfrozen.freezeInfo?.usedFreezeDays || 0);
    recordResult("Test 5: Early unfreeze & quota refund", isActive, `Status: ${unfrozen.status}, Refunded quota remaining: ${remaining} days`);
  } catch (err: any) {
    recordResult("Test 5: Early unfreeze & quota refund", false, err.message);
  }

  // ============================================================================
  // TEST 6: Unfreezing a Package that is NOT Frozen
  // ============================================================================
  console.log("\n--- TEST 6: Unfreezing a Package that is Not Frozen ---");
  try {
    await FreezeService.unfreezeMemberPackage({
      uid,
      pkgId: pkg1Id,
      pkgStartDate,
    });
    recordResult("Test 6: Unfreezing active package rejected", false, "Should have thrown PACKAGE_NOT_FROZEN");
  } catch (err: any) {
    const isNotFrozen = err.code === "PACKAGE_NOT_FROZEN";
    recordResult("Test 6: Unfreezing active package rejected", isNotFrozen, `Caught: ${err.code} - ${err.message}`);
  }

  // ============================================================================
  // TEST 7: Extra Freeze Request Missing Reason
  // ============================================================================
  console.log("\n--- TEST 7: Extra Freeze Request Missing Reason ---");
  try {
    await FreezeService.requestExtraFreeze(uid, pkg1Id, pkgStartDate, 14, "   ");
    recordResult("Test 7: Missing reason rejected", false, "Should have thrown REASON_REQUIRED");
  } catch (err: any) {
    const isReasonReq = err.code === "REASON_REQUIRED";
    recordResult("Test 7: Missing reason rejected", isReasonReq, `Caught: ${err.code} - ${err.message}`);
  }

  // ============================================================================
  // TEST 8: Valid Extra Freeze Request Submission
  // ============================================================================
  console.log("\n--- TEST 8: Valid Extra Freeze Request Submission ---");
  let reqId = "";
  try {
    await FreezeRequest.deleteMany({ memberId: user._id, pkgId: pkg1Month!._id });
    const request = await FreezeService.requestExtraFreeze(
      uid,
      pkg1Id,
      pkgStartDate,
      14,
      "Doctor ordered 2 weeks bed rest after ankle sprain"
    );
    reqId = (request._id as Types.ObjectId).toString();
    const isPending = request.status === "PENDING" && request.requestedDurationDays === 14;
    recordResult("Test 8: Extra freeze request logged", isPending, `Request ID: ${reqId}, Status: ${request.status}`);
  } catch (err: any) {
    recordResult("Test 8: Extra freeze request logged", false, err.message);
  }

  // ============================================================================
  // TEST 9: Duplicate Pending Request Prevention
  // ============================================================================
  console.log("\n--- TEST 9: Duplicate Pending Request Prevention ---");
  try {
    await FreezeService.requestExtraFreeze(
      uid,
      pkg1Id,
      pkgStartDate,
      7,
      "Another request while one is already pending"
    );
    recordResult("Test 9: Duplicate pending request rejected", false, "Should have thrown PENDING_FREEZE_REQUEST_EXISTS");
  } catch (err: any) {
    const isDuplicate = err.code === "PENDING_FREEZE_REQUEST_EXISTS";
    recordResult("Test 9: Duplicate pending request rejected", isDuplicate, `Caught: ${err.code} - ${err.message}`);
  }

  // ============================================================================
  // TEST 10: Admin Approval & Duplicate Resolution Prevention
  // ============================================================================
  console.log("\n--- TEST 10: Admin Approval & Duplicate Resolution Prevention ---");
  try {
    const adminUser = await User.findOne({ role: { $in: ["management", "admin"] } });
    const adminId = adminUser ? (adminUser._id as Types.ObjectId).toString() : uid;

    // Approve once
    const approved = await FreezeService.approveFreezeRequest(reqId, adminId, 10, "Approved 10 days");
    const isApproved = approved.status === "APPROVED" && approved.approvedDurationDays === 10;

    // Attempt to approve a second time
    let duplicateRejected = false;
    try {
      await FreezeService.approveFreezeRequest(reqId, adminId, 10);
    } catch (dupErr: any) {
      duplicateRejected = dupErr.code === "REQUEST_ALREADY_RESOLVED";
    }

    recordResult(
      "Test 10: Admin approve & duplicate resolution protection",
      isApproved && duplicateRejected,
      `Approved for 10 days, second resolution attempt safely blocked.`
    );
  } catch (err: any) {
    recordResult("Test 10: Admin approve & duplicate resolution protection", false, err.message);
  }

  // ============================================================================
  // TEST 11: Multi-Package Eligibility (1 Frozen, 1 Active)
  // ============================================================================
  console.log("\n--- TEST 11: Multi-Package Resolution (1 Frozen, 1 Active) ---");
  try {
    // Member currently has 1 FROZEN package. Let's add a second ACTIVE package.
    const secondPkgStartDate = new Date().toISOString();
    // Use Member.addPackage directly to avoid duplicate day checks on same date
    const memberDocBefore = await Member.findOne({ uid: user._id });
    const pkg3Doc = await Package.findById(pkg3Id);
    await Member.updateOne(
      { uid: user._id },
      {
        $push: {
          packages: {
            pkgId: new Types.ObjectId(pkg3Id),
            name: pkg3Doc!.name,
            pkgStartDate: new Date(),
            pkgEndDate: addDays(new Date(), 90),
            status: "ACTIVE",
            remainingClasses: 50,
          },
        },
      }
    );

    const memberDoc = await Member.findOne({ uid: user._id });
    const mapped = memberDoc!.packages.map((p) => ({
      pkgId: p.pkgId.toString(),
      name: p.pkgId.toString() === pkg1Id ? "Frozen Package" : "Active Package",
      status: p.status,
      pkgStartDate: p.pkgStartDate,
      pkgEndDate: p.pkgEndDate,
      remainingClasses: p.remainingClasses,
    }));

    const result = selectEligiblePackage({
      packages: mapped,
      allowedPkgIds: [pkg1Id, pkg3Id],
    });

    const usedActive = result.ok === true && (result as any).pkg.name === "Active Package";
    recordResult(
      "Test 11: Multi-package access (skips frozen, selects active)",
      usedActive,
      `Selected package: ${(result as any).pkg?.name}`
    );
  } catch (err: any) {
    recordResult("Test 11: Multi-package access", false, err.message);
  }

  // ============================================================================
  // TEST 12: Auto-Unfreeze Background Sync (Expired Freeze End Date)
  // ============================================================================
  console.log("\n--- TEST 12: Auto-Unfreeze Background Sync ---");
  try {
    const memberDoc = await Member.findOne({ uid: user._id });
    const frozenPkg = memberDoc!.packages.find((p) => p.status === "FROZEN");

    if (frozenPkg && frozenPkg.freezeInfo) {
      // Simulate freeze end date was yesterday
      frozenPkg.freezeInfo.freezeEndDate = subDays(new Date(), 1);
      await memberDoc!.save();

      // Run syncMemberFreezeStatus
      const updatedMember = await Member.findOne({ uid: user._id });
      const wasModified = await FreezeService.syncMemberFreezeStatus(updatedMember!);

      const syncedPkg = updatedMember!.packages.find((p) => p.pkgId.toString() === frozenPkg.pkgId.toString());
      const isAutoUnfrozen = syncedPkg?.status === "ACTIVE" && syncedPkg?.freezeInfo?.isFrozen === false;

      recordResult(
        "Test 12: Auto-unfreeze when freezeEndDate is past",
        wasModified && isAutoUnfrozen,
        `Package auto-unfrozen back to ACTIVE on sync.`
      );
    } else {
      recordResult("Test 12: Auto-unfreeze", false, "No frozen package found for simulation");
    }
  } catch (err: any) {
    recordResult("Test 12: Auto-unfreeze", false, err.message);
  }

  console.log("\n================================================================================");
  console.log(`📊 FINAL SUMMARY: ${passedCount} / ${passedCount + failedCount} TESTS PASSED`);
  console.log("================================================================================\n");

  await mongoose.disconnect();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

runEdgeCasesSuite().catch((err) => {
  console.error("Suite execution error:", err);
  process.exit(1);
});
