/**
 * clone-fareeda-to-prod.ts
 *
 * Clones Fareeda Khaled's profile from Firebase / Firestore and her staged package
 * in nonuserpackages into the PROD MongoDB database (TMS_PROD) with a bcrypt-hashed password,
 * creating both User and Member documents so she is fully functional without manual re-registration.
 *
 * Usage:
 *   npx ts-node src/scripts/clone-fareeda-to-prod.ts [--dry-run] [--password=YourPass123!] [--keep-dates]
 *
 * Options:
 *   --dry-run       Preview changes without writing to MongoDB
 *   --password=...  Specify a custom password (defaults to 'Fareeda@2026!')
 *   --keep-dates    Preserve original staged package dates (2026-07-05 to 2026-08-04) instead of renewing for 30 days from today
 */

import dotenv from "dotenv";
import path from "path";

// Load prod.env first, fall back to dev.env if needed
dotenv.config({ path: path.join(__dirname, "../../prod.env") });
if (!process.env.MONGO_URI || process.env.MONGO_URI.includes("FILL_IN")) {
  dotenv.config({ path: path.join(__dirname, "../../dev.env") });
}

import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const DEFAULT_MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://yasserziad59_db_user:UHSM9oTJOnPT1r2x@ac-ynhcti6-shard-00-00.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-01.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-02.nenjvkr.mongodb.net:27017/TMS_PROD?ssl=true&replicaSet=atlas-vmtjfi-shard-0&authSource=admin&appName=Cluster0";

// Firebase / Firestore source data for Fareeda Khaled
const SOURCE_DATA = {
  firebaseUid: "bVWVXr5nr6eT9ttLRHF4EwvXg8Q2",
  name: "Fareeda Khaled",
  email: "fkhaledhm@gmail.com",
  phoneNumber: "01118003010",
  fcmToken:
    "f7KgraNtg0D6jMLDJ6-nId:APA91bEN_19QD0XfCtUyi7ut6O0VTb2AzkZuuGNpZc2SFeyteJf57k26GYv-BhuMjJdXC52ssWRPgwREvWl3wTtAmdScY9vYZ2VO-hwVAM1iqNkwHR6Am8s",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const keepDates = args.includes("--keep-dates");
  const passwordArg = args.find((a) => a.startsWith("--password="));
  const password = passwordArg
    ? passwordArg.split("=")[1]
    : process.env.MEMBER_PASSWORD || "Fareeda@2026!";

  return { isDryRun, keepDates, password };
}

function assertPasswordRequirements(pwd: string) {
  if (pwd.length < 10) {
    throw new Error("Password must be at least 10 characters long");
  }
  if (!/[a-zA-Z]/.test(pwd)) {
    throw new Error("Password must contain at least one letter");
  }
  if (!/[0-9]/.test(pwd)) {
    throw new Error("Password must contain at least one number");
  }
  if (!/[^a-zA-Z0-9]/.test(pwd)) {
    throw new Error("Password must contain at least one special character");
  }
}

async function main() {
  const { isDryRun, keepDates, password } = parseArgs();
  assertPasswordRequirements(password);

  console.log("==========================================================");
  console.log("   CLONE FAREEDA KHALED TO PROD DATABASE (TMS_PROD)");
  console.log("==========================================================");
  if (isDryRun) {
    console.log(">>> RUNNING IN DRY-RUN MODE (No database changes will be saved) <<<\n");
  }

  // 1. Connect to MongoDB
  console.log("[1/6] Connecting to MongoDB PROD...");
  await mongoose.connect(DEFAULT_MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Failed to obtain MongoDB database reference.");
  }
  console.log("      Connected to database:", mongoose.connection.name);

  // 2. Check if user already exists
  console.log("\n[2/6] Checking existing accounts...");
  const existingUser = await db.collection("users").findOne({
    $or: [
      { phoneNumber: SOURCE_DATA.phoneNumber },
      { email: SOURCE_DATA.email.toLowerCase() },
    ],
  });

  if (existingUser) {
    console.log("      [INFO] User already exists in MongoDB:", {
      _id: existingUser._id,
      name: existingUser.name,
      phone: existingUser.phoneNumber,
      email: existingUser.email,
      role: existingUser.role,
    });
  } else {
    console.log("      [OK] No existing user record found for phone:", SOURCE_DATA.phoneNumber);
  }

  // 3. Hash password with bcrypt (12 rounds)
  console.log("\n[3/6] Generating bcrypt password hash...");
  const saltRounds = 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  console.log(`      Password:   "${password}"`);
  console.log(`      Salt Rounds: ${saltRounds}`);
  console.log(`      Hash:       ${hashedPassword.substring(0, 28)}...`);

  // 4. Generate Mobile Auth JWT Token
  console.log("\n[4/6] Preparing mobile authentication token...");
  const targetUserId = existingUser ? existingUser._id : new Types.ObjectId();
  const jwtSecret =
    process.env.JWT_SECRET && process.env.JWT_SECRET !== "FILL_IN"
      ? process.env.JWT_SECRET
      : null;

  let tokens: Array<{ token: string; device: string; _id: Types.ObjectId }> = [];
  let generatedJwtToken: string | null = null;

  if (jwtSecret) {
    const tokenPayload = {
      uid: targetUserId.toString(),
      role: "member",
      deviceType: "mobile",
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    };
    generatedJwtToken = jwt.sign(tokenPayload, jwtSecret);
    tokens.push({
      token: generatedJwtToken,
      device: "mobile",
      _id: new Types.ObjectId(),
    });
    console.log("      [OK] Generated non-expiring mobile JWT auth token.");
  } else {
    console.log("      [WARN] JWT_SECRET not found in env; she can log in with phone + password.");
  }

  // 5. Look up staged package in nonuserpackages
  console.log("\n[5/6] Checking staged package in nonuserpackages...");
  const stagedPkg = await db.collection("nonuserpackages").findOne({
    phoneNumber: SOURCE_DATA.phoneNumber,
  });

  let memberPackages: any[] = [];
  if (stagedPkg) {
    console.log("      [FOUND] Staged package in nonuserpackages:", {
      id: stagedPkg._id,
      name: stagedPkg.name,
      pkgId: stagedPkg.pkgId,
      remainingClasses: stagedPkg.remainingClasses,
      added: stagedPkg.added,
      originalDates: `${stagedPkg.pkgStartDate?.toISOString?.() ?? stagedPkg.pkgStartDate} -> ${stagedPkg.pkgEndDate?.toISOString?.() ?? stagedPkg.pkgEndDate}`,
    });

    // Lookup package definition to get locationId and duration
    const pkgDef = await db.collection("packages").findOne({ _id: stagedPkg.pkgId });
    const locationId = pkgDef?.locationId ?? new Types.ObjectId("69ec4abad8394559ce7ca77c");

    let startDate: Date;
    let endDate: Date;

    if (keepDates && stagedPkg.pkgStartDate && stagedPkg.pkgEndDate) {
      startDate = new Date(stagedPkg.pkgStartDate);
      endDate = new Date(stagedPkg.pkgEndDate);
      console.log("      [OPTION] Keeping original dates (Note: already expired in August).");
    } else {
      // Renew for 30 days starting now so she has an ACTIVE package today
      startDate = new Date();
      endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      console.log(`      [RENEW] Setting active dates: ${startDate.toISOString()} -> ${endDate.toISOString()}`);
    }

    const isCurrentlyActive = new Date() >= startDate && new Date() <= endDate;

    memberPackages.push({
      _id: new Types.ObjectId(),
      pkgId: stagedPkg.pkgId,
      name: pkgDef?.name ?? "Space membership",
      pkgStartDate: startDate,
      pkgEndDate: endDate,
      status: isCurrentlyActive ? "ACTIVE" : "EXPIRED",
      remainingClasses: stagedPkg.remainingClasses ?? 10000,
      classRestrictionsRecord: [],
      locationId: locationId,
      adjustmentHistory: [],
    });
  } else {
    console.log("      [INFO] No staged package found in nonuserpackages.");
  }

  // 6. Execute Insertions / Updates
  console.log("\n[6/6] Executing database writes...");
  if (isDryRun) {
    console.log("      [DRY RUN] Would insert User:", {
      _id: targetUserId,
      name: SOURCE_DATA.name,
      email: SOURCE_DATA.email,
      phoneNumber: SOURCE_DATA.phoneNumber,
      role: "member",
      fcmTokens: [SOURCE_DATA.fcmToken],
      hasMobileToken: tokens.length > 0,
    });

    console.log("      [DRY RUN] Would insert Member:", {
      uid: targetUserId,
      packageCount: memberPackages.length,
      packages: memberPackages,
      isActive: true,
    });

    if (stagedPkg) {
      console.log("      [DRY RUN] Would update nonuserpackages._id:", stagedPkg._id, "with added: true");
    }

    console.log("\n>>> DRY RUN COMPLETED SUCCESSFULLY. Run without --dry-run to commit changes. <<<");
    await mongoose.disconnect();
    return;
  }

  // Real write
  if (!existingUser) {
    const userDoc = {
      _id: targetUserId,
      name: SOURCE_DATA.name,
      email: SOURCE_DATA.email.toLowerCase(),
      phoneNumber: SOURCE_DATA.phoneNumber,
      password: hashedPassword,
      role: "member",
      tokens: tokens,
      fcmTokens: [SOURCE_DATA.fcmToken],
      resetCode: "",
      createdAt: new Date(),
    };

    await db.collection("users").insertOne(userDoc);
    console.log("      [SUCCESS] User created with _id:", targetUserId);
  } else {
    // Update existing user with bcrypt password and ensure role is member
    await db.collection("users").updateOne(
      { _id: existingUser._id },
      {
        $set: {
          role: "member",
          password: hashedPassword,
          name: SOURCE_DATA.name,
        },
        $addToSet: {
          fcmTokens: SOURCE_DATA.fcmToken,
          ...(tokens.length > 0 ? { tokens: tokens[0] } : {}),
        } as any,
      }
    );
    console.log("      [SUCCESS] Existing user updated with bcrypt password and role='member'.");
  }

  // Check / Upsert Member document
  const existingMember = await db.collection("members").findOne({ uid: targetUserId });
  if (!existingMember) {
    const memberDoc = {
      _id: new Types.ObjectId(),
      uid: targetUserId,
      packages: memberPackages,
      bookings: [],
      attendance: [],
      ptAttendance: [],
      isActive: true,
      createdAt: new Date(),
    };

    await db.collection("members").insertOne(memberDoc);
    console.log("      [SUCCESS] Member document created with _id:", memberDoc._id);
  } else {
    if (memberPackages.length > 0) {
      await db.collection("members").updateOne(
        { uid: targetUserId },
        {
          $push: { packages: { $each: memberPackages } as any },
          $set: { isActive: true },
        }
      );
      console.log("      [SUCCESS] Member document updated with package.");
    }
  }

  // Update nonuserpackages to added: true
  if (stagedPkg) {
    await db.collection("nonuserpackages").updateOne(
      { _id: stagedPkg._id },
      { $set: { added: true } }
    );
    console.log("      [SUCCESS] nonuserpackages record marked added: true.");
  }

  console.log("\n==========================================================");
  console.log("                 CLONING COMPLETE!                        ");
  console.log("==========================================================");
  console.log("  Member Details:");
  console.log("    Name:         ", SOURCE_DATA.name);
  console.log("    Phone:        ", SOURCE_DATA.phoneNumber);
  console.log("    Email:        ", SOURCE_DATA.email);
  console.log("    Password:     ", password);
  console.log("    Role:         ", "member");
  console.log("    User ID:      ", targetUserId.toString());
  console.log("    Dashboard:    ", "Will now appear under 'Our Members'");
  if (memberPackages.length > 0) {
    console.log("    Package:      ", memberPackages[0].name);
    console.log("    Status:       ", memberPackages[0].status);
    console.log("    Remaining:    ", memberPackages[0].remainingClasses);
    console.log("    Valid Until:  ", memberPackages[0].pkgEndDate.toISOString());
  }
  console.log("==========================================================");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n[FATAL ERROR]:", err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
