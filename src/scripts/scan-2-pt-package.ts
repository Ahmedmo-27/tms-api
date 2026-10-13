import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import { runInTransaction } from "../utils/transaction";

/**
 * Script 2: Performs the last session QR scan for the Personal Training Package by Sessions
 * ("10 Personal Training with Salma Ghazzawi" - PERSONAL_TRAINING) for TMS Member (01222222222).
 * Deducts remainingClasses from 1 -> 0 and sends the FCM push notification.
 */
async function scanPtPackage() {
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log("✅ Connected to TMS_TEST database.");

    const user = await User.findOne({ phoneNumber: "01222222222" });
    if (!user) {
      throw new Error("User TMS Member (01222222222) not found in TMS_TEST");
    }

    const ptPkg = await Package.findById("69e78ecbc824630af794120b");
    if (!ptPkg) {
      throw new Error(
        "Package '10 Personal Training with Salma Ghazzawi' not found in TMS_TEST"
      );
    }

    const member = await Member.findOne({ uid: user._id });
    if (!member) {
      throw new Error(
        "Member document not found. Run `npm run sim:setup` first."
      );
    }

    const targetPkg = member.packages.find(
      (p) => String(p.pkgId) === String(ptPkg._id)
    );
    if (!targetPkg) {
      throw new Error(
        "PT package not found on TMS Member. Run `npm run sim:setup` first."
      );
    }

    // Reset to 1 remaining class & clear today's PT attendance so the scan succeeds every time
    targetPkg.remainingClasses = 1;
    targetPkg.status = "ACTIVE";
    targetPkg.lastSessionNotifiedAt = undefined;
    member.ptAttendance = [];
    await member.save();

    const ioMock = { emit: () => {} } as any;

    console.log(
      `\n🔄 Scanning last PT session of "${ptPkg.name}" (remainingClasses: 1 -> 0) for ${user.name} (${user.phoneNumber})...`
    );

    await runInTransaction(async (session) => {
      await Member.recordPtAttendance(
        String(user._id),
        [String(ptPkg._id)],
        session,
        ioMock,
        ptPkg.name
      );
    });

    console.log(
      `✅ PT scan complete! "${ptPkg.name}" now has remainingClasses: 0 (COMPLETED) and push notification was sent to ${user.name}.`
    );

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error running scan-2-pt-package:", err);
    process.exit(1);
  }
}

scanPtPackage();
