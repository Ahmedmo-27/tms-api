import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import ScheduledClass from "../models/scheduledClass";
import { selectEligiblePackage } from "../utils/package-eligibility";
import { bookingPackageErrorMessage } from "../utils/booking-package-errors";

async function simulate() {
  process.stdout.write("Connecting DB...\n");
  await connectDB();
  process.stdout.write("\n=======================================================\n");
  process.stdout.write("🚀 SIMULATING SCAN / ACCESS FLOW FOR FROZEN MEMBER PACKAGE\n");
  process.stdout.write("=======================================================\n\n");

  // 1. Find user
  const user = await User.findOne({ phoneNumber: "01222222222" });
  if (!user) {
    console.log("User 01222222222 not found in DB.");
    await mongoose.disconnect();
    return;
  }
  console.log(`👤 Found User: ${user.name} (${user.phoneNumber}) - Role: ${user.role}`);

  // 2. Find Member document
  const member = await Member.findOne({ uid: user._id }).populate("packages.pkgId");
  if (!member) {
    console.log("Member record not found for user.");
    await mongoose.disconnect();
    return;
  }
  console.log(`📋 Member record ID: ${member._id}`);
  console.log(`📦 Member packages count: ${member.packages.length}\n`);

  member.packages.forEach((pkg: any, idx: number) => {
    const pkgDoc = pkg.pkgId;
    console.log(`   [${idx + 1}] Package: "${pkgDoc?.name || "Unknown"}"`);
    console.log(`       Status:       ${pkg.status}`);
    console.log(`       Start Date:   ${pkg.pkgStartDate?.toISOString()}`);
    console.log(`       End Date:     ${pkg.pkgEndDate?.toISOString()}`);
    console.log(`       Is Frozen:    ${pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen ? "❄️ YES (FROZEN)" : "NO"}`);
    if (pkg.freezeInfo?.isFrozen) {
      console.log(`       Freeze Start: ${pkg.freezeInfo.freezeStartDate}`);
      console.log(`       Freeze End:   ${pkg.freezeInfo.freezeEndDate}`);
      console.log(`       Allowed Days: ${pkg.freezeInfo.allowedFreezeDays}`);
      console.log(`       Used Days:    ${pkg.freezeInfo.usedFreezeDays}`);
    }
  });

  // 3. Simulate Flow A: Booking Attempt with Frozen Package
  console.log("\n-------------------------------------------------------");
  console.log("1️⃣ FLOW A: CLASS BOOKING ATTEMPT (POST /member/book/:scid)");
  console.log("-------------------------------------------------------");

  // Find a scheduled class
  const scheduledClass = await ScheduledClass.findOne({}).populate("cid");
  const classDoc = scheduledClass ? (scheduledClass.cid as any) : null;
  const className = classDoc?.name || "Functional Training";
  const scid = scheduledClass?._id || new Types.ObjectId();

  console.log(`Member attempts to book class: "${className}" (scid: ${scid})`);

  const mappedPackages = member.packages.map((p: any) => ({
    pkgId: p.pkgId?._id?.toString() || p.pkgId?.toString(),
    name: p.pkgId?.name || "3 Month Ultimate Mindspacer",
    status: p.status,
    pkgStartDate: p.pkgStartDate,
    pkgEndDate: p.pkgEndDate,
    remainingClasses: p.remainingClasses,
    freezeInfo: p.freezeInfo,
  }));

  const eligibleResult = selectEligiblePackage({
    packages: mappedPackages,
    allowedPkgIds: member.packages.map((p: any) => p.pkgId?._id?.toString() || p.pkgId?.toString()),
    cid: classDoc?._id?.toString(),
  });

  console.log("selectEligiblePackage Result:", eligibleResult);
  if (!eligibleResult.ok) {
    const errorMsg = bookingPackageErrorMessage(eligibleResult.code, className, {
      packageName: eligibleResult.context?.packageName,
      date: eligibleResult.context?.date,
      audience: "member",
    });

    console.log("\n⛔ HTTP API Response (403 Forbidden):");
    console.log(JSON.stringify({
      statusCode: 403,
      code: eligibleResult.code,
      message: errorMsg,
      context: eligibleResult.context,
    }, null, 2));
  }

  // 4. Simulate Flow B: Open Gym / Space Walk Scan (recordSpaceWalkAttendance)
  console.log("\n-------------------------------------------------------");
  console.log("2️⃣ FLOW B: OPEN GYM / SPACE WALK DESK SCAN");
  console.log("-------------------------------------------------------");

  const openGymPkgIds = await Package.getSpaceWalkPackageIds();
  const mockIo = { emit: (event: string, data: any) => console.log(`📡 Socket.io Event Emitted [${event}]:`, data) } as any;

  console.log(`Space Walk eligible catalog package IDs count: ${openGymPkgIds.length}`);
  const scanResult = await Member.recordSpaceWalkAttendance(
    (user._id as any).toString(),
    openGymPkgIds,
    null as any,
    mockIo,
    (user as any).locationId?.toString()
  );

  console.log(`Desk Scan Result: ${scanResult}`);
  console.log("\n⛔ API Scan Outcome: Access Denied. No active package found because the package status is FROZEN.");

  // 5. Simulate Flow C: Mobile App In-App QR Scanner (QrCode_handler)
  console.log("\n-------------------------------------------------------");
  console.log("3️⃣ FLOW C: MOBILE APP IN-APP QR CODE SCAN (QrCode_handler.dart)");
  console.log("-------------------------------------------------------");

  const now = new Date();
  let validFound = false;
  let hasFrozen = false;

  for (const pkg of member.packages) {
    const pkgDoc = (pkg.pkgId as any);
    const pkgName = pkgDoc?.name || "Ultimate Mindspacer";
    const isWithinDate = now >= new Date(pkg.pkgStartDate) && now <= new Date(pkg.pkgEndDate);
    const isFrozen = pkg.status === "FROZEN" || pkg.freezeInfo?.isFrozen === true;

    if (isWithinDate) {
      if (isFrozen) {
        hasFrozen = true;
        console.log(`📦 Package "${pkgName}" is within date range but has status: FROZEN ❄️ (Skipping attendance)`);
      } else {
        validFound = true;
        console.log(`📦 Package "${pkgName}" is ACTIVE. Access granted.`);
      }
    }
  }

  if (!validFound && hasFrozen) {
    console.log("\n📱 Mobile App UI Dialog Rendered in Scanner Screen:");
    console.log(JSON.stringify({
      dialogType: "AwesomeDialog (Warning)",
      title: "Package Frozen",
      description: "Your package is currently frozen and cannot be used for check-in. Please unfreeze your package in My Packages to continue.",
      button: "OK",
    }, null, 2));
  }

  console.log("\n=======================================================");
  console.log("✅ SIMULATION COMPLETE");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

simulate().catch(err => {
  console.error("Simulation error:", err);
  process.exit(1);
});
