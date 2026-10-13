import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import { runInTransaction } from "../utils/transaction";

/**
 * Script 1: Performs the last session scan/deduction for the Class Package by Sessions
 * ("10 Functional Training" - FUNCTIONAL_TRAINING) for TMS Member (01222222222).
 * Deducts remainingClasses from 1 -> 0 and sends the FCM push notification.
 */
async function scanClassPackage() {
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log("✅ Connected to TMS_TEST database.");

    const user = await User.findOne({ phoneNumber: "01222222222" });
    if (!user) {
      throw new Error("User TMS Member (01222222222) not found in TMS_TEST");
    }

    const functionalPkg = await Package.findById("69e53352408d55818779818b");
    if (!functionalPkg) {
      throw new Error("Package '10 Functional Training' not found in TMS_TEST");
    }

    const member = await Member.findOne({ uid: user._id });
    if (!member) {
      throw new Error(
        "Member document not found. Run `npm run sim:setup` first."
      );
    }

    // Ensure the package has 1 remaining session and is ACTIVE so the scan deducts 1 -> 0
    const targetPkg = member.packages.find(
      (p) => String(p.pkgId) === String(functionalPkg._id)
    );
    if (!targetPkg) {
      throw new Error(
        "10 Functional Training package not found on TMS Member. Run `npm run sim:setup` first."
      );
    }

    if (targetPkg.remainingClasses !== 1 || targetPkg.status !== "ACTIVE" || targetPkg.lastSessionNotifiedAt) {
      targetPkg.remainingClasses = 1;
      targetPkg.status = "ACTIVE";
      targetPkg.lastSessionNotifiedAt = undefined;
      await member.save();
    }

    const fakeScid = new Types.ObjectId().toString();
    const fakeCid = new Types.ObjectId().toString();
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    console.log(
      `\n🔄 Scanning/booking last session of "${functionalPkg.name}" (remainingClasses: 1 -> 0) for ${user.name} (${user.phoneNumber})...`
    );

    await runInTransaction(async (session) => {
      await Member.saveBooking(
        String(user._id),
        [String(functionalPkg._id)],
        fakeScid,
        false,
        false,
        fakeCid,
        monthStr,
        1,
        session,
        "Functional HIIT",
        now
      );
    });

    console.log(
      `✅ Scan complete! "${functionalPkg.name}" now has remainingClasses: 0 (COMPLETED) and push notification was sent to ${user.name}.`
    );

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error running scan-1-class-package:", err);
    process.exit(1);
  }
}

scanClassPackage();
