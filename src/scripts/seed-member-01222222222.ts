/**
 * seed-member-01222222222.ts
 *
 * Ensures the user with phoneNumber 01222222222 has a linked Member document.
 * Run from tms_api/: npx ts-node src/scripts/seed-member-01222222222.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";

async function main() {
  await connectDB();

  const user = await User.findOne({ phoneNumber: "01222222222" });
  if (!user) {
    console.error("[ERROR] No user found with phoneNumber 01222222222.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[OK] User found: ${user.name} (${user.role})`);

  const existing = await Member.findOne({ uid: user._id });
  if (existing) {
    console.log("[SKIP] Member document already exists for this user.");
    await mongoose.disconnect();
    return;
  }

  const member = new Member({
    uid: user._id,
    packages: [],
    bookings: [],
    attendance: [],
    ptAttendance: [],
    isActive: true,
  });

  await member.save();
  console.log("[OK] Member document created.");
  console.log(`     User ID:   ${user._id}`);
  console.log(`     Member ID: ${member._id}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
