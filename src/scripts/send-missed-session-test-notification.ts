import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import Class from "../models/class";
import Location from "../models/location";
import ScheduledClass from "../models/scheduledClass";
import { MissedSessionService } from "../services/missed-session-service";
import admin from "../config/firebase";

const PHONE_NUMBER = "01222222222";
const PASSWORD = "tms@member";

async function main() {
  console.log("=".repeat(80));
  console.log("TMS Missed-Session Live Push Notification Test Script");
  console.log("=".repeat(80));

  await connectDB();

  // 1. Verify User
  let user = await User.findOne({ phoneNumber: PHONE_NUMBER });
  if (!user) {
    user = await User.create({
      phoneNumber: PHONE_NUMBER,
      password: PASSWORD,
      name: "TMS Test Member",
      email: "member01222222222@test.local",
      role: "member",
      fcmTokens: [],
    });
    console.log(`[USER] Created user: ${user.name} (${PHONE_NUMBER})`);
  } else {
    console.log(`[USER] Found user: ${user.name} (${user.phoneNumber}, ID: ${user._id})`);
  }

  // Check FCM Tokens
  const fcmTokens = (user.fcmTokens ?? []).filter((t) => typeof t === "string" && t.trim().length > 0);
  console.log(`[FCM] Registered device tokens count: ${fcmTokens.length}`);

  if (fcmTokens.length === 0) {
    console.log("\n" + "!".repeat(80));
    console.log("⚠️  NO FCM TOKEN FOUND FOR THIS USER IN THE DATABASE!");
    console.log("👉 To receive the push notification on your Android Emulator:");
    console.log("   1. Open the Android Emulator and start The Mind Space app.");
    console.log(`   2. Log in with:`);
    console.log(`      Phone Number : ${PHONE_NUMBER}`);
    console.log(`      Password     : ${PASSWORD}`);
    console.log("   3. Once logged in, the app automatically syncs your FCM token to the DB.");
    console.log("   4. Re-run this script: npx ts-node src/scripts/send-missed-session-test-notification.ts");
    console.log("!".repeat(80) + "\n");
  } else {
    console.log(`[FCM] Active device token: ${fcmTokens[0].substring(0, 30)}...`);
  }

  // 2. Verify / Create Member Document
  let member = await Member.findOne({ uid: user._id });
  if (!member) {
    member = await Member.create({
      uid: user._id,
      packages: [],
      bookings: [],
      attendance: [],
      isActive: true,
    });
    console.log(`[MEMBER] Created Member record for user ID ${user._id}`);
  }

  // 3. Find an actual Package and Class in the DB
  const realPackage = await Package.findOne({
    status: { $ne: "DEPRECATED" },
    category: { $in: ["STUDIO", "FITNESS", "CLASS", "MIXED"] },
    opensClasses: { $exists: true, $not: { $size: 0 } },
  }).populate("opensClasses");

  if (!realPackage) {
    console.error("[ERROR] No real active package found in the database.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n[PACKAGE] Selected real DB package: "${realPackage.name}" (ID: ${realPackage._id}, Category: ${realPackage.category})`);

  // 4. Ensure member has this package active with sessions
  let memberPkg = member.packages.find(
    (p) => String(p.pkgId) === String(realPackage._id) && p.status === "ACTIVE" && p.remainingClasses > 0
  );

  const locationId = realPackage.locationId || (await Location.findOne())?._id;

  if (!memberPkg) {
    console.log(`[PACKAGE] Adding active "${realPackage.name}" package with 10 sessions to member...`);
    const newPkgEntry = {
      pkgId: realPackage._id,
      name: realPackage.name,
      pkgStartDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      pkgEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: "ACTIVE",
      remainingClasses: 10,
      adjustmentHistory: [],
      locationId: locationId,
    };
    await Member.updateOne({ uid: user._id }, { $push: { packages: newPkgEntry } });
    member = (await Member.findOne({ uid: user._id }))!;
    memberPkg = member.packages.find((p) => String(p.pkgId) === String(realPackage._id));
  }

  console.log(`[MEMBER PACKAGE] Current remaining classes: ${memberPkg?.remainingClasses}`);

  // 5. Select an actual class covered by this package
  const actualClassId = realPackage.opensClasses[0];
  const actualClassDoc = await Class.findById(actualClassId);

  if (!actualClassDoc) {
    console.error("[ERROR] Could not find linked class document.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[CLASS] Selected real DB class: "${actualClassDoc.title}" (ID: ${actualClassDoc._id})`);

  // 6. Create or use an actual ScheduledClass that ended 10 minutes ago
  const now = new Date();
  const startTime = new Date(now.getTime() - 70 * 60 * 1000); // 1h 10m ago
  const endTime = new Date(now.getTime() - 10 * 60 * 1000);   // 10m ago

  const scheduledClass = await ScheduledClass.create({
    cid: actualClassDoc._id,
    locationId: locationId,
    startTime: startTime,
    endTime: endTime,
    availableSlots: 10,
    bookedMembers: [
      {
        uid: user._id,
        method: realPackage.name,
        packageName: realPackage.name,
        bookingTime: new Date(startTime.getTime() - 2 * 60 * 60 * 1000),
      },
    ],
    scans: [],
  });

  console.log(`\n[SCHEDULED CLASS] Created completed class session:`);
  console.log(`   ID        : ${scheduledClass._id}`);
  console.log(`   Class     : ${actualClassDoc.title}`);
  console.log(`   Start Time: ${startTime.toLocaleTimeString("en-US", { timeZone: "Africa/Cairo" })} Cairo time`);
  console.log(`   End Time  : ${endTime.toLocaleTimeString("en-US", { timeZone: "Africa/Cairo" })} Cairo time`);

  // 7. Add booking to member with no attendance and no previous missedNotifiedAt
  await Member.updateOne(
    { uid: user._id },
    {
      $pull: {
        bookings: { scid: scheduledClass._id },
        attendance: { scid: scheduledClass._id },
      },
    }
  );

  await Member.updateOne(
    { uid: user._id },
    {
      $push: {
        bookings: {
          scid: scheduledClass._id,
          bookingTime: new Date(startTime.getTime() - 2 * 60 * 60 * 1000),
          isDropIn: false,
        },
      },
    }
  );

  console.log(`[BOOKING] Member ${user.name} booked into session ${scheduledClass._id} (Unattended / Missed).`);

  // 8. Trigger MissedSessionService
  console.log(`\n[TRIGGER] Running MissedSessionService.notifyMissedSessions()...`);
  const summary = await MissedSessionService.notifyMissedSessions(now);

  console.log("\n" + "=".repeat(80));
  console.log("RESULT SUMMARY");
  console.log("=".repeat(80));
  console.log(`Classes checked : ${summary.classesChecked}`);
  console.log(`Notified        : ${summary.notified}`);
  console.log(`Skipped         : ${summary.skipped}`);
  console.log(`Failed          : ${summary.failed}`);

  // Check if booking was marked as notified
  const updatedMember = await Member.findOne({ uid: user._id });
  const b = updatedMember?.bookings.find((item) => String(item.scid) === String(scheduledClass._id));
  console.log(`\nBooking claimed with missedNotifiedAt: ${b?.missedNotifiedAt}`);

  if (fcmTokens.length > 0) {
    console.log(`\n📲 Push notification sent via Firebase Cloud Messaging to your device!`);
    console.log(`   Title: Missed Session`);
    console.log(`   Body : You missed ${actualClassDoc.title} at ${startTime.toLocaleTimeString("en-US", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" })}. The session was counted from your package.`);
  } else {
    console.log(`\nℹ️  The backend processed the missed session logic successfully.`);
    console.log(`   To see the push notification on your emulator screen, log in on the emulator and run this script again!`);
  }
  console.log("=".repeat(80));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error executing script:", err);
  process.exit(1);
});
