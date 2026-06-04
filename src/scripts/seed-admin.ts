/**
 * seed-admin.ts
 *
 * Creates the initial admin user.
 * Run from tms_api/: npx ts-node src/scripts/seed-admin.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";

async function main() {
  await connectDB();

  const existing = await User.findOne({ phoneNumber: "01208522334" });
  if (existing) {
    console.log("[SKIP] Admin user already exists.");
    await mongoose.disconnect();
    return;
  }

  const user = new User({
    name: "Tolan",
    email: "omar.tolan@gmail.com",
    phoneNumber: "01208522334",
    password: "Admin123",
    role: "admin",
  });

  await user.save();
  console.log("[OK] Admin user created.");
  console.log(`     Name:  ${user.name}`);
  console.log(`     Phone: ${user.phoneNumber}`);
  console.log(`     Email: ${user.email}`);
  console.log(`     Role:  ${user.role}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
