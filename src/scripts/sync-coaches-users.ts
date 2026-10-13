import dotenv from "dotenv";
import path from "path";
import mongoose, { Types } from "mongoose";
import User, { IUser } from "../models/user";
import Coach, { ICoach } from "../models/coach";

interface UnlinkedCoachConfig {
  coachQuery: { coachName: string | RegExp };
  expectedCoachName: string;
  userPayload: {
    name: string;
    email: string;
    phoneNumber: string;
    role: "coach";
    tempPassword: string;
  };
}

interface EmailUpdateConfig {
  coachName: string;
  currentEmail: string;
  targetEmail: string;
  isTypoCandidate?: boolean;
}

const UNLINKED_COACHES: UnlinkedCoachConfig[] = [
  {
    coachQuery: { coachName: "Dana" },
    expectedCoachName: "Dana",
    userPayload: {
      name: "Dana Abu Ghazaleh",
      email: "danaabughazaleh1@gmail.com",
      phoneNumber: "01114043598",
      role: "coach",
      tempPassword: "Coach@TMS2026!",
    },
  },
  {
    coachQuery: { coachName: "Hana Khaled" },
    expectedCoachName: "Hana Khaled",
    userPayload: {
      name: "Hana Khaled",
      email: "hanakhaled1907@gmail.com",
      phoneNumber: "01004000223",
      role: "coach",
      tempPassword: "Coach@TMS2026!",
    },
  },
];

const EMAIL_UPDATES: EmailUpdateConfig[] = [
  {
    coachName: "Omar ElAlamy",
    currentEmail: "elalamyomar@gmail.com",
    targetEmail: "omarelalamy@gmail.com",
  },
  {
    coachName: "Toqa",
    currentEmail: "toqamohamed268@yahoo.com",
    targetEmail: "toqamohamed268@gmail.com",
  },
  {
    coachName: "Zeina Zidan",
    currentEmail: "zeinazidan2005@gmail.com",
    targetEmail: "zeinazidan@aucegypt.edu",
  },
  {
    coachName: "Nour Rashad",
    currentEmail: "nour.rashad.space@gmail.com",
    targetEmail: "coachnarashad@gmail.com",
  },
  {
    coachName: "Hana Elmeneisy",
    currentEmail: "hanaminisy8955@gmail.com",
    targetEmail: "banaminisy8955@gmail.com",
    isTypoCandidate: true,
  },
];

async function main() {
  const isApply = process.argv.includes("--apply");
  const isProd = !process.argv.includes("--dev");
  const includeTypoEmails = process.argv.includes("--include-typo-emails");
  const envFile = isProd ? "prod.env" : "dev.env";

  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`❌ MONGO_URI not found in ${envFile}!`);
    process.exit(1);
  }

  console.log(`\n======================================================================`);
  console.log(` COACH USER SYNC & EMAIL UPDATE REPORT [${isApply ? "APPLY MODE" : "DRY RUN"}]`);
  console.log(` Target Environment: ${envFile}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================================\n`);

  await mongoose.connect(uri);

  const actions: Array<{
    category: "CREATE_USER_AND_LINK" | "UPDATE_EMAIL" | "SKIPPED_TYPO";
    summary: string;
    details: Record<string, unknown>;
    execute?: () => Promise<void>;
  }> = [];

  // ---------------------------------------------------------------------------
  // 1. PROCESS UNLINKED COACHES
  // ---------------------------------------------------------------------------
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`1. AUDITING UNLINKED COACHES`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  for (const item of UNLINKED_COACHES) {
    const coach = await Coach.findOne(item.coachQuery);
    if (!coach) {
      console.log(`⚠️ Coach "${item.expectedCoachName}" not found in DB!`);
      continue;
    }

    const coachIdStr = String(coach._id);

    if (coach.userId) {
      console.log(`ℹ️ Coach "${coach.coachName}" (ID: ${coachIdStr}) is ALREADY LINKED to User ID: ${String(coach.userId)}`);
      continue;
    }

    // Check if user already exists with this email or phone
    const existingEmailUser = await User.findOne({ email: item.userPayload.email.toLowerCase() });
    const existingPhoneUser = await User.findOne({ phoneNumber: item.userPayload.phoneNumber });

    if (existingEmailUser) {
      const existingUserIdStr = String(existingEmailUser._id);
      console.log(`⚠️ User with email "${item.userPayload.email}" already exists (ID: ${existingUserIdStr})! Linking to coach...`);
      actions.push({
        category: "CREATE_USER_AND_LINK",
        summary: `Link existing user (${existingEmailUser.email}) to Coach "${coach.coachName}"`,
        details: {
          coachId: coachIdStr,
          coachName: coach.coachName,
          existingUserId: existingUserIdStr,
          updatePhoneNumber: item.userPayload.phoneNumber,
        },
        execute: async () => {
          coach.userId = existingEmailUser._id as Types.ObjectId;
          coach.phoneNumber = item.userPayload.phoneNumber;
          await coach.save();
        },
      });
      continue;
    }

    if (existingPhoneUser) {
      console.log(`⚠️ User with phone "${item.userPayload.phoneNumber}" already exists (ID: ${String(existingPhoneUser._id)}, Email: ${existingPhoneUser.email})!`);
      continue;
    }

    actions.push({
      category: "CREATE_USER_AND_LINK",
      summary: `Create new coach user for "${item.userPayload.name}" and link to Coach "${coach.coachName}"`,
      details: {
        coachId: coachIdStr,
        coachName: coach.coachName,
        userName: item.userPayload.name,
        email: item.userPayload.email,
        phoneNumber: item.userPayload.phoneNumber,
        role: item.userPayload.role,
        tempPassword: item.userPayload.tempPassword,
      },
      execute: async () => {
        const newUser = new User({
          name: item.userPayload.name,
          email: item.userPayload.email.toLowerCase(),
          phoneNumber: item.userPayload.phoneNumber,
          password: item.userPayload.tempPassword,
          role: item.userPayload.role,
        });
        await newUser.save();

        coach.userId = newUser._id as Types.ObjectId;
        coach.phoneNumber = item.userPayload.phoneNumber;
        await coach.save();
      },
    });

    console.log(`  ➕ [PENDING] Create User & Link Coach "${coach.coachName}"`);
    console.log(`     Email: ${item.userPayload.email} | Phone: ${item.userPayload.phoneNumber} | Name: "${item.userPayload.name}"`);
  }

  // ---------------------------------------------------------------------------
  // 2. PROCESS EMAIL UPDATES
  // ---------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`2. AUDITING EMAIL UPDATES`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  for (const item of EMAIL_UPDATES) {
    if (item.isTypoCandidate && !includeTypoEmails) {
      console.log(`  🛡️ [SKIPPED - OBVIOUS TYPO PROTECTED] Coach "${item.coachName}"`);
      console.log(`     Target was "${item.targetEmail}" which is a 1-letter typo for active DB email "${item.currentEmail}".`);
      console.log(`     (Pass --include-typo-emails if you explicitly want to apply this typo to the database)`);
      actions.push({
        category: "SKIPPED_TYPO",
        summary: `Protect Coach "${item.coachName}" from typo replacement (${item.targetEmail})`,
        details: {
          coachName: item.coachName,
          currentEmail: item.currentEmail,
          targetEmailCandidate: item.targetEmail,
          reason: "Preserved legitimate active email against input typo",
        },
      });
      continue;
    }

    const coach = await Coach.findOne({ coachName: new RegExp(`^${item.coachName}$`, "i") });
    if (!coach || !coach.userId) {
      console.log(`⚠️ Coach "${item.coachName}" or linked user not found!`);
      continue;
    }

    const user = await User.findById(coach.userId);
    if (!user) {
      console.log(`⚠️ User ID ${String(coach.userId)} for coach "${coach.coachName}" not found!`);
      continue;
    }

    const currentEmailStr = (user.email || "").toLowerCase();
    if (currentEmailStr === item.targetEmail.toLowerCase()) {
      console.log(`ℹ️ Coach "${coach.coachName}" already has target email: ${item.targetEmail}`);
      continue;
    }

    // Check if target email is already taken by another user
    const emailConflict = await User.findOne({
      email: item.targetEmail.toLowerCase(),
      _id: { $ne: user._id },
    });

    if (emailConflict) {
      console.log(`❌ Cannot update "${item.coachName}": target email "${item.targetEmail}" already taken by User ID: ${String(emailConflict._id)}!`);
      continue;
    }

    const userIdStr = String(user._id);
    const coachIdStr = String(coach._id);

    actions.push({
      category: "UPDATE_EMAIL",
      summary: `Update User email for Coach "${coach.coachName}" from "${user.email}" -> "${item.targetEmail}"`,
      details: {
        userId: userIdStr,
        coachId: coachIdStr,
        coachName: coach.coachName,
        oldEmail: user.email,
        newEmail: item.targetEmail.toLowerCase(),
      },
      execute: async () => {
        user.email = item.targetEmail.toLowerCase();
        await user.save();
      },
    });

    console.log(`  🔄 [PENDING] Update Email for Coach "${coach.coachName}"`);
    console.log(`     Current: ${user.email} -> New: ${item.targetEmail}`);
  }

  // ---------------------------------------------------------------------------
  // 3. SUMMARY & EXECUTION
  // ---------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`3. ACTION SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total actions proposed: ${actions.length}`);

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    console.log(`\nAction #${i + 1} [${act.category}]: ${act.summary}`);
    console.log(`  Details:`, JSON.stringify(act.details, null, 2));
  }

  const executableActions = actions.filter((a) => typeof a.execute === "function");

  if (!isApply) {
    console.log(`\n======================================================================`);
    console.log(` [DRY RUN COMPLETED] No changes were written to ${envFile}.`);
    console.log(` To apply these updates to PROD, run:`);
    console.log(`   npm run sync-coaches-users:apply`);
    console.log(`   or: npx ts-node src/scripts/sync-coaches-users.ts --apply`);
    console.log(` To also include the typo email replacement for Hana Elmeneisy, add:`);
    console.log(`   npx ts-node src/scripts/sync-coaches-users.ts --apply --include-typo-emails`);
    console.log(`======================================================================\n`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\n⏳ Applying ${executableActions.length} changes to ${envFile}...`);
  for (const act of executableActions) {
    if (act.execute) {
      await act.execute();
      console.log(`  ✅ Done: ${act.summary}`);
    }
  }

  console.log(`\n✅ ALL ${executableActions.length} ACTIONS SUCCESSFULLY APPLIED TO ${envFile}!`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
