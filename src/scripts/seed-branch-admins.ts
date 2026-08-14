/**
 * seed-branch-admins.ts
 *
 * Creates branch_admin + management staff accounts.
 * Passwords MUST come from environment variables (never commit plaintext).
 *
 * Required env (per account key):
 *   SEED_PASSWORD_LAVISTA_BAY
 *   SEED_PASSWORD_RAS_HEKMA
 *   SEED_PASSWORD_MATCHA
 *   SEED_PASSWORD_MGMT_ALI
 *   SEED_PASSWORD_MGMT_ZIAD
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
  passwordEnvKey: string;
  role: "branch_admin" | "management";
  branchLookup?: string;
  branchLabel: string;
};

const accounts: StaffAccount[] = [
  {
    name: "Dado",
    phoneNumber: "01111120748",
    email: "branch.lavistabay@themindspace.app",
    passwordEnvKey: "SEED_PASSWORD_LAVISTA_BAY",
    role: "branch_admin",
    branchLookup: "la vista bay",
    branchLabel: "La Vista Bay",
  },
  {
    name: "Mostafa Waleed",
    phoneNumber: "01016062290",
    email: "branch.rashekma@themindspace.app",
    passwordEnvKey: "SEED_PASSWORD_RAS_HEKMA",
    role: "branch_admin",
    branchLookup: "la vista ras el hekma",
    branchLabel: "La Vista Ras El Hekma",
  },
  {
    name: "Ahmed Samy",
    phoneNumber: "01024158232",
    email: "branch.matcha@themindspace.app",
    passwordEnvKey: "SEED_PASSWORD_MATCHA",
    role: "branch_admin",
    branchLookup: "matcha",
    branchLabel: "Matcha",
  },
  {
    name: "Ali Ahmed",
    phoneNumber: "01276666770",
    email: "management.ali@themindspace.app",
    passwordEnvKey: "SEED_PASSWORD_MGMT_ALI",
    role: "management",
    branchLabel: "Management",
  },
  {
    name: "Ziad Yasser",
    phoneNumber: "01284961078",
    email: "management.ziad@themindspace.app",
    passwordEnvKey: "SEED_PASSWORD_MGMT_ZIAD",
    role: "management",
    branchLabel: "Management",
  },
];

const FALLBACK_LOCATION_IDS: Record<string, string> = {
  matcha: "6a3e9509c72a8d349f150910",
  "la vista ras el hekma": "6a3e9547c72a8d349f150911",
  "la vista bay": "6a1cb1e81452dc01d9f4f8ea",
};

function requirePassword(envKey: string): string {
  const value = process.env[envKey]?.trim();
  if (!value || value.length < 10) {
    throw new Error(
      `Missing or weak password for ${envKey}. Set it in the environment (min 10 chars).`,
    );
  }
  return value;
}

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
      `   No Location doc matched "${branchLookup}" — using fallback id ${fallback}`,
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
      `   Dropped existing user ${user.name} (${user.phoneNumber}, ${user.role})` +
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
    const password = requirePassword(account.passwordEnvKey);
    console.log(`→ ${account.name} [${account.role}] — ${account.branchLabel}`);

    await dropExistingByPhoneOrEmail(account.phoneNumber, account.email);

    const payload: Record<string, unknown> = {
      name: account.name,
      phoneNumber: account.phoneNumber,
      email: account.email,
      password,
      role: account.role,
    };

    if (account.role === "branch_admin" && account.branchLookup) {
      payload.locationId = await resolveLocationId(account.branchLookup);
    }

    const user = new User(payload);
    await user.save();

    console.log(`   Created`);
    console.log(`      Phone   : ${account.phoneNumber}`);
    console.log(`      Email   : ${account.email}`);
    console.log(`      Password: [REDACTED — from ${account.passwordEnvKey}]`);
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
