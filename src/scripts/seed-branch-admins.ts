/**
 * seed-branch-admins.ts
 *
 * Creates branch_admin + management staff accounts.
 * If a phone (or target email) already has a user, drops it (and any Member)
 * then recreates with the details below.
 *
 * Run: npx ts-node src/scripts/seed-branch-admins.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import User from "../models/user";
import Member from "../models/member";
import Location from "../models/location";

type StaffAccount = {
  name: string;
  phoneNumber: string;
  email: string;
  password: string;
  role: "branch_admin" | "management";
  /** Location lookup key ΓÇö only for branch_admin */
  branchLookup?: string;
  branchLabel: string;
};

const accounts: StaffAccount[] = [
  {
    name: "Dado",
    phoneNumber: "01111120748",
    email: "branch.lavistabay@themindspace.app",
    password: "Bay@tmsadmin2026",
    role: "branch_admin",
    branchLookup: "la vista bay",
    branchLabel: "La Vista Bay",
  },
  {
    name: "Mostafa Waleed",
    phoneNumber: "01016062290",
    email: "branch.rashekma@themindspace.app",
    password: "RasHekma@tmsadmin2026",
    role: "branch_admin",
    branchLookup: "la vista ras el hekma",
    branchLabel: "La Vista Ras El Hekma",
  },
  {
    name: "Ahmed Samy",
    phoneNumber: "01024158232",
    email: "branch.matcha@themindspace.app",
    password: "Matcha@tmsadmin2026",
    role: "branch_admin",
    branchLookup: "matcha",
    branchLabel: "Matcha",
  },
  {
    name: "Ali Ahmed",
    phoneNumber: "01276666770",
    email: "management.ali@themindspace.app",
    password: "Ali@management2026",
    role: "management",
    branchLabel: "Management",
  },
  {
    name: "Ziad Yasser",
    phoneNumber: "01284961078",
    email: "management.ziad@themindspace.app",
    password: "Ziad@management2026",
    role: "management",
    branchLabel: "Management",
  },
];

/** Prefer known production/test IDs when DB lookup fails or is ambiguous. */
const FALLBACK_LOCATION_IDS: Record<string, string> = {
  matcha: "6a3e9509c72a8d349f150910",
  "la vista ras el hekma": "6a3e9547c72a8d349f150911",
  "la vista bay": "6a1cb1e81452dc01d9f4f8ea",
};

async function resolveLocationId(
  branchLookup: string,
): Promise<mongoose.Types.ObjectId> {
  const needle = branchLookup.toLowerCase().trim();

  const locations = await Location.find({});
  const match = locations.find((loc) => {
    const hay = `${loc.branchName} ${loc.location}`.toLowerCase();
    return hay.includes(needle);
  });

  if (match) {
    return match._id as mongoose.Types.ObjectId;
  }

  const fallback = FALLBACK_LOCATION_IDS[needle];
  if (fallback) {
    console.log(
      `   ΓÜá∩╕Å  No Location doc matched "${branchLookup}" ΓÇö using fallback id ${fallback}`,
    );
    return new mongoose.Types.ObjectId(fallback);
  }

  throw new Error(`Could not resolve location for "${branchLookup}"`);
}

async function dropExistingByPhoneOrEmail(
  phoneNumber: string,
  email: string,
): Promise<void> {
  const existing = await User.find({
    $or: [{ phoneNumber }, { email: email.toLowerCase() }],
  });

  for (const user of existing) {
    const memberResult = await Member.deleteMany({ uid: user._id });
    await User.deleteOne({ _id: user._id });
    console.log(
      `   ≡ƒùæ∩╕Å  Dropped existing user ${user.name} (${user.phoneNumber}, ${user.role})` +
        (memberResult.deletedCount
          ? ` + ${memberResult.deletedCount} member doc(s)`
          : ""),
    );
  }
}

async function main() {
  await connectDB();

  console.log("\n=== Seeding Staff Accounts (drop + recreate) ===\n");

  for (const account of accounts) {
    console.log(`ΓåÆ ${account.name} [${account.role}] ΓÇö ${account.branchLabel}`);

    await dropExistingByPhoneOrEmail(account.phoneNumber, account.email);

    const payload: Record<string, unknown> = {
      name: account.name,
      phoneNumber: account.phoneNumber,
      email: account.email,
      // Plain password ΓÇö User pre-save hook hashes it
      password: account.password,
      role: account.role,
    };

    if (account.role === "branch_admin" && account.branchLookup) {
      payload.locationId = await resolveLocationId(account.branchLookup);
    }

    const user = new User(payload);
    await user.save();

    console.log(`   Γ£à Created`);
    console.log(`      Phone   : ${account.phoneNumber}`);
    console.log(`      Email   : ${account.email}`);
    console.log(`      Password: ${account.password}`);
    if (payload.locationId) {
      console.log(`      Location: ${payload.locationId}`);
    }
    console.log("");
  }

  console.log("=== Done ===\n");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
