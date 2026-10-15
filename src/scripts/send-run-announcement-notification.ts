import dotenv from "dotenv";
import path from "path";

// 1. Determine environment before importing modules that depend on env vars
const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const isApply = args.includes("--apply");
const envFile = isDev ? "dev.env" : "prod.env";

dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

import mongoose from "mongoose";
import * as admin from "firebase-admin";
import User, { IUser } from "../models/user";

// Ensure Firebase Admin is initialized
function ensureFirebaseInitialized() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!raw || raw === "FILL_IN") {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_BASE64 not found or not set in ${envFile}`);
    }
    const serviceAccountKey = JSON.parse(Buffer.from(raw, "base64").toString());
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountKey),
    });
  }
}

// Parse command line arguments
function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

const DEFAULT_TITLE = "THE MIND SPACE";
const DEFAULT_BODY = "SPACERS, YOU DON’T WANT TO MISS THIS! 🚨\n&RUN IS BACK!\nBook your spot now";

const customTitle = getArgValue("--title") || DEFAULT_TITLE;
const customBody = getArgValue("--body") || DEFAULT_BODY;
const testPhone = getArgValue("--test-phone");
const testToken = getArgValue("--test-token");
const roleFilterArg = getArgValue("--role"); // e.g. "member" or "member,user"
const shouldCleanupInvalid = args.includes("--cleanup-invalid") || isApply;

const FCM_MAX_TOKENS = 500;

function chunkTokens(tokens: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += size) {
    chunks.push(tokens.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx ts-node src/scripts/send-run-announcement-notification.ts [options]

Options:
  --apply                Actually dispatch notifications to Firebase (default is dry-run preview)
  --dev                  Use dev.env instead of prod.env
  --prod                 Use prod.env (default)
  --test-phone <phone>   Send only to the user with the specified phone number (e.g. 01222222222)
  --test-token <token>   Send directly to a specific FCM device token
  --role <roles>         Filter users by role(s), comma-separated (e.g. "member" or "member,user")
  --title "<title>"      Override notification title (default: "THE MIND SPACE")
  --body "<body>"        Override notification body (default: "SPACERS, YOU DON’T WANT TO MISS THIS! 🚨\\n&RUN IS BACK!\\nBook your spot now")
  --cleanup-invalid      Remove expired/invalid FCM tokens from DB (enabled automatically on --apply)
  -h, --help             Show this help screen
`);
    return;
  }

  console.log("=".repeat(80));
  console.log("TMS MOBILE PUSH NOTIFICATION BROADCAST SCRIPT");
  console.log("=".repeat(80));
  console.log(`Environment       : ${envFile}`);
  console.log(`Mode              : ${isApply ? "🚀 APPLY (LIVE BROADCAST)" : "🔍 DRY RUN (Preview only)"}`);
  console.log(`Notification Title: ${customTitle}`);
  console.log(`Notification Body : \n${customBody.split("\n").map(l => "   " + l).join("\n")}`);
  if (testPhone) console.log(`Target Filter     : Single user with phone ${testPhone}`);
  else if (testToken) console.log(`Target Filter     : Single direct FCM token`);
  else if (roleFilterArg) console.log(`Target Filter     : Roles [${roleFilterArg}] with FCM tokens`);
  else console.log(`Target Filter     : All mobile app users with FCM tokens`);
  console.log("=".repeat(80));

  ensureFirebaseInitialized();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error(`❌ MONGO_URI is missing in ${envFile}!`);
    process.exit(1);
  }

  console.log("\nConnecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log(" Connected to MongoDB.");

  let recipientTokens: string[] = [];
  let targetedUsersCount = 0;

  if (testToken) {
    recipientTokens = [testToken.trim()];
    targetedUsersCount = 1;
    console.log(`\nDirect test token provided: ${testToken.substring(0, 30)}...`);
  } else {
    const query: any = {
      fcmTokens: { $exists: true, $not: { $size: 0 } },
    };

    if (testPhone) {
      query.phoneNumber = testPhone.trim();
    } else if (roleFilterArg) {
      const roles = roleFilterArg.split(",").map(r => r.trim());
      query.role = { $in: roles };
    }

    console.log("\nQuerying mobile app users with active FCM tokens...");
    const users = await User.find(query).select("name phoneNumber role fcmTokens");
    targetedUsersCount = users.length;

    console.log(`Found ${targetedUsersCount} user(s) matching criteria.`);

    // Flatten and deduplicate tokens
    const allTokens = users.flatMap((u) => u.fcmTokens ?? []);
    recipientTokens = [
      ...new Set(
        allTokens.filter((t): t is string => typeof t === "string" && t.trim() !== "")
      ),
    ];
  }

  console.log(`Total valid, unique FCM device tokens: ${recipientTokens.length}`);

  if (recipientTokens.length === 0) {
    console.log("\n⚠️ No registered device tokens found. Exiting.");
    await mongoose.disconnect();
    return;
  }

  // Preview first 5 tokens
  console.log("\nDevice tokens sample (up to 5):");
  recipientTokens.slice(0, 5).forEach((t, i) => {
    console.log(` [${i + 1}] ${t.substring(0, 40)}... (length: ${t.length})`);
  });

  const chunks = chunkTokens(recipientTokens, FCM_MAX_TOKENS);
  console.log(`\nTokens split into ${chunks.length} batch(es) (max ${FCM_MAX_TOKENS} per batch).`);

  if (!isApply) {
    console.log("\n" + "#".repeat(80));
    console.log("ℹ️  DRY RUN COMPLETE — NO NOTIFICATIONS WERE SENT");
    console.log("#".repeat(80));
    console.log(`If you run this with --apply, ${recipientTokens.length} device(s) will receive:`);
    console.log(`  TITLE: ${customTitle}`);
    console.log(`  BODY : ${JSON.stringify(customBody)}`);
    console.log("\nTo test sending to a single user first, run:");
    console.log(`  npx ts-node src/scripts/send-run-announcement-notification.ts ${isDev ? "--dev " : ""}--test-phone <PHONE_NUMBER> --apply`);
    console.log("\nTo broadcast to all mobile users, run:");
    console.log(`  npx ts-node src/scripts/send-run-announcement-notification.ts ${isDev ? "--dev " : ""}--apply`);
    console.log("#".repeat(80) + "\n");
    await mongoose.disconnect();
    return;
  }

  // Apply mode: send notifications
  console.log("\n" + "=".repeat(80));
  console.log("🚀 SENDING PUSH NOTIFICATIONS...");
  console.log("=".repeat(80));

  let totalSuccessful = 0;
  let totalFailed = 0;
  const invalidTokens: string[] = [];

  const dataPayload: Record<string, string> = {
    type: "ANNOUNCEMENT",
    category: "RUN",
    title: customTitle,
    body: customBody,
    sentAt: new Date().toISOString(),
  };

  for (let bIndex = 0; bIndex < chunks.length; bIndex++) {
    const batch = chunks[bIndex];
    console.log(`\nSending Batch ${bIndex + 1}/${chunks.length} (${batch.length} tokens)...`);

    const message: admin.messaging.MulticastMessage = {
      tokens: batch,
      notification: {
        title: customTitle,
        body: customBody,
      },
      data: dataPayload,
      android: {
        priority: "high" as const,
        notification: {
          sound: "default",
          channelId: "default",
          priority: "high" as const,
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      totalSuccessful += response.successCount;
      totalFailed += response.failureCount;

      console.log(` Batch ${bIndex + 1} result: ${response.successCount} succeeded, ${response.failureCount} failed.`);

      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === "messaging/registration-token-not-registered" ||
              errorCode === "messaging/invalid-registration-token"
            ) {
              invalidTokens.push(batch[idx]);
            }
          }
        });
      }
    } catch (err: any) {
      console.error(`❌ Batch ${bIndex + 1} fatal send error:`, err?.message || err);
      totalFailed += batch.length;
    }
  }

  // Cleanup invalid tokens from DB if any were found
  if (shouldCleanupInvalid && invalidTokens.length > 0) {
    console.log(`\n🧹 Cleaning up ${invalidTokens.length} expired/invalid FCM token(s) from database...`);
    try {
      const updateResult = await User.updateMany(
        { fcmTokens: { $in: invalidTokens } },
        { $pull: { fcmTokens: { $in: invalidTokens } } }
      );
      console.log(` Cleaned up invalid tokens across ${updateResult.modifiedCount} user record(s).`);
    } catch (err: any) {
      console.error("⚠️ Failed to clean up invalid tokens:", err?.message || err);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("BROADCAST RESULTS SUMMARY");
  console.log("=".repeat(80));
  console.log(`Target Users Count : ${targetedUsersCount}`);
  console.log(`Total Tokens Sent  : ${recipientTokens.length}`);
  console.log(`Successfully Sent  : ${totalSuccessful}`);
  console.log(`Failed Tokens      : ${totalFailed}`);
  if (invalidTokens.length > 0) {
    console.log(`Stale/Invalid Tokens: ${invalidTokens.length} (cleaned up from DB)`);
  }
  console.log("=".repeat(80) + "\n");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Fatal script error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
