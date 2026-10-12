import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import { runInTransaction } from "../utils/transaction";
import { toStoredPackageDate } from "../utils/timezone";

/**
 * Script 3: Performs the Open Gym QR scan 1 day before expiry for the Period-based Open Gym Package
 * ("Space membership" - OPEN_GYM) for TMS Member (01222222222).
 * Detects 1 day remaining before pkgEndDate and sends the FCM push notification.
 */
async function scanOpenGymPackage() {
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log("✅ Connected to TMS_TEST database.");

    const user = await User.findOne({ phoneNumber: "01222222222" });
    if (!user) {
      throw new Error("User TMS Member (01222222222) not found in TMS_TEST");
    }

    const openGymPkg = await Package.findById("6a47f348b71a5d31d730e735");
    if (!openGymPkg) {
      throw new Error("Package 'Space membership' not found in TMS_TEST");
    }

    const member = await Member.findOne({ uid: user._id });
    if (!member) {
      throw new Error(
        "Member document not found. Run `npm run sim:setup` first."
      );
    }

    const targetPkg = member.packages.find(
      (p) => String(p.pkgId) === String(openGymPkg._id)
    );
    if (!targetPkg) {
      throw new Error(
        "Space membership package not found on TMS Member. Run `npm run sim:setup` first."
      );
    }

    // Ensure pkgEndDate is 1 day from today and clear expiryWarningNotifiedAt so the scan sends the notification
    const now = new Date();
    const tomorrowEnd = toStoredPackageDate(
      new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
    );
    targetPkg.pkgEndDate = tomorrowEnd;
    targetPkg.status = "ACTIVE";
    targetPkg.expiryWarningNotifiedAt = undefined;
    await member.save();

    const ioMock = { emit: () => {} } as any;

    console.log(
      `\n🔄 Scanning Open Gym "${openGymPkg.name}" (expires in 1 day: ${tomorrowEnd.toISOString().slice(0, 10)}) for ${user.name} (${user.phoneNumber})...`
    );

    await runInTransaction(async (session) => {
      await Member.recordSpaceWalkAttendance(
        String(user._id),
        [String(openGymPkg._id)],
        session,
        ioMock
      );
    });

    console.log(
      `✅ Open Gym scan complete! 1-Day Expiry Warning recorded on "${openGymPkg.name}" and push notification was sent to ${user.name}.`
    );

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error running scan-3-opengym-package:", err);
    process.exit(1);
  }
}

scanOpenGymPackage();
