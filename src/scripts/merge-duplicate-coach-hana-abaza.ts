/**
 * merge-duplicate-coach-hana-abaza.ts
 *
 * Merges duplicate coach "Hana Abaza" (unlinked doc: 6aa83752f491eb785ab39653)
 * into primary coach "Hana Abaza" (linked doc: 69e6764f28c5113f3b4e6f51).
 *
 * Usage:
 *   Dry-run (preview only, no DB writes):
 *     npx ts-node src/scripts/merge-duplicate-coach-hana-abaza.ts
 *
 *   Apply changes to production:
 *     npx ts-node src/scripts/merge-duplicate-coach-hana-abaza.ts --apply
 *
 *   Target dev environment instead of prod:
 *     npx ts-node src/scripts/merge-duplicate-coach-hana-abaza.ts --dev
 */

import dotenv from "dotenv";
import path from "path";
import mongoose, { Types } from "mongoose";

const isDev = process.argv.includes("--dev");
const envFile = isDev ? "dev.env" : "prod.env";
const envPath = path.join(__dirname, `../../${envFile}`);

dotenv.config({ path: envPath });

const isApply = process.argv.includes("--apply");
const isDryRun = !isApply;

const PRIMARY_COACH_ID = new Types.ObjectId("69e6764f28c5113f3b4e6f51");
const DUPLICATE_COACH_ID = new Types.ObjectId("6aa83752f491eb785ab39653");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`❌ MONGO_URI not found in ${envFile}!`);
    process.exit(1);
  }

  console.log(`\n======================================================================`);
  console.log(` MERGE DUPLICATE COACH HANA ABAZA [${isApply ? "APPLY MODE" : "DRY RUN"}]`);
  console.log(` Target Environment: ${envFile}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================================\n`);

  if (isDryRun) {
    console.log("ℹ️  Running in DRY RUN mode. No database writes will be executed.");
    console.log("ℹ️  To apply changes, run with: --apply\n");
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Failed to access MongoDB database instance");
  }

  // 1. Verify primary and duplicate coaches
  const primaryDoc = await db.collection("coaches").findOne({ _id: PRIMARY_COACH_ID });
  const duplicateDoc = await db.collection("coaches").findOne({ _id: DUPLICATE_COACH_ID });

  console.log("1. Coach Documents Status:");
  if (primaryDoc) {
    console.log(`  ✅ Primary Coach found:   "${primaryDoc.coachName}" (_id: ${primaryDoc._id}, phone: ${primaryDoc.phoneNumber}, userId: ${primaryDoc.userId})`);
  } else {
    console.error(`  ❌ Primary Coach NOT found (_id: ${PRIMARY_COACH_ID})! Aborting.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (duplicateDoc) {
    console.log(`  ⚠️  Duplicate Coach found: "${duplicateDoc.coachName}" (_id: ${duplicateDoc._id}, phone: ${duplicateDoc.phoneNumber}, userId: ${duplicateDoc.userId ?? "NONE"})`);
  } else {
    console.log(`  ℹ️  Duplicate Coach (_id: ${DUPLICATE_COACH_ID}) already does not exist in coaches collection.`);
  }

  // 2. Scheduled Classes referencing Duplicate Coach
  console.log("\n2. Scanning scheduledclasses for references to duplicate coach...");
  const scheduledClassesWithDuplicate = await db.collection("scheduledclasses").find({
    coachId: DUPLICATE_COACH_ID,
  }).toArray();

  console.log(`  Found ${scheduledClassesWithDuplicate.length} scheduled class(es) referencing duplicate coach ID.`);

  for (const sc of scheduledClassesWithDuplicate) {
    const rawCoachIds: Types.ObjectId[] = Array.isArray(sc.coachId) ? sc.coachId : [sc.coachId];
    // Replace duplicate with primary and deduplicate
    const updatedCoachIdsSet = new Set<string>();
    for (const cid of rawCoachIds) {
      if (cid && cid.toString() === DUPLICATE_COACH_ID.toString()) {
        updatedCoachIdsSet.add(PRIMARY_COACH_ID.toString());
      } else if (cid) {
        updatedCoachIdsSet.add(cid.toString());
      }
    }
    const updatedCoachIds = Array.from(updatedCoachIdsSet).map((id) => new Types.ObjectId(id));

    console.log(`  - SCID: ${sc._id} | Start: ${sc.startTime} | Current: [${rawCoachIds.join(", ")}] -> Target: [${updatedCoachIds.join(", ")}]`);

    if (isApply) {
      await db.collection("scheduledclasses").updateOne(
        { _id: sc._id },
        { $set: { coachId: updatedCoachIds } }
      );
    }
  }

  // 3. Check and migrate other collections (classes, packages, members, deductionlogs, coachnotifications)
  console.log("\n3. Checking other collections for duplicate coach references...");

  // Classes
  const classesWithDuplicate = await db.collection("classes").find({
    $or: [{ coach: DUPLICATE_COACH_ID }, { coachId: DUPLICATE_COACH_ID }, { coaches: DUPLICATE_COACH_ID }],
  }).toArray();
  console.log(`  Classes referencing duplicate coach: ${classesWithDuplicate.length}`);
  if (isApply && classesWithDuplicate.length > 0) {
    for (const c of classesWithDuplicate) {
      const update: any = {};
      if (c.coach && c.coach.toString() === DUPLICATE_COACH_ID.toString()) update.coach = PRIMARY_COACH_ID;
      if (c.coachId && c.coachId.toString() === DUPLICATE_COACH_ID.toString()) update.coachId = PRIMARY_COACH_ID;
      if (Array.isArray(c.coaches)) {
        update.coaches = c.coaches.map((id: any) => id.toString() === DUPLICATE_COACH_ID.toString() ? PRIMARY_COACH_ID : id);
      }
      await db.collection("classes").updateOne({ _id: c._id }, { $set: update });
    }
  }

  // Packages
  const packagesWithDuplicate = await db.collection("packages").find({ coachId: DUPLICATE_COACH_ID }).toArray();
  console.log(`  Packages referencing duplicate coach: ${packagesWithDuplicate.length}`);
  if (isApply && packagesWithDuplicate.length > 0) {
    await db.collection("packages").updateMany(
      { coachId: DUPLICATE_COACH_ID },
      { $set: { coachId: PRIMARY_COACH_ID } }
    );
  }

  // Members packages
  const membersWithDuplicate = await db.collection("members").find({
    $or: [{ "packages.coachId": DUPLICATE_COACH_ID }, { "ptPackages.coachId": DUPLICATE_COACH_ID }],
  }).toArray();
  console.log(`  Members referencing duplicate coach: ${membersWithDuplicate.length}`);
  if (isApply && membersWithDuplicate.length > 0) {
    await db.collection("members").updateMany(
      { "packages.coachId": DUPLICATE_COACH_ID },
      { $set: { "packages.$[elem].coachId": PRIMARY_COACH_ID } },
      { arrayFilters: [{ "elem.coachId": DUPLICATE_COACH_ID }] }
    );
    await db.collection("members").updateMany(
      { "ptPackages.coachId": DUPLICATE_COACH_ID },
      { $set: { "ptPackages.$[elem].coachId": PRIMARY_COACH_ID } },
      { arrayFilters: [{ "elem.coachId": DUPLICATE_COACH_ID }] }
    );
  }

  // Deduction Logs
  const deductionsWithDuplicate = await db.collection("deductionlogs").find({ coachId: DUPLICATE_COACH_ID }).toArray();
  console.log(`  Deduction logs referencing duplicate coach: ${deductionsWithDuplicate.length}`);
  if (isApply && deductionsWithDuplicate.length > 0) {
    await db.collection("deductionlogs").updateMany(
      { coachId: DUPLICATE_COACH_ID },
      { $set: { coachId: PRIMARY_COACH_ID } }
    );
  }

  // Coach Notifications
  const notificationsWithDuplicate = await db.collection("coachnotifications").find({
    $or: [{ coachId: DUPLICATE_COACH_ID }, { coachDocId: DUPLICATE_COACH_ID }],
  }).toArray();
  console.log(`  Coach notifications referencing duplicate coach: ${notificationsWithDuplicate.length}`);
  if (isApply && notificationsWithDuplicate.length > 0) {
    await db.collection("coachnotifications").updateMany(
      { coachId: DUPLICATE_COACH_ID },
      { $set: { coachId: PRIMARY_COACH_ID } }
    );
    await db.collection("coachnotifications").updateMany(
      { coachDocId: DUPLICATE_COACH_ID },
      { $set: { coachDocId: PRIMARY_COACH_ID } }
    );
  }

  // 4. Delete the duplicate coach document
  if (duplicateDoc) {
    if (isApply) {
      const deleteResult = await db.collection("coaches").deleteOne({ _id: DUPLICATE_COACH_ID });
      console.log(`\n4. Deleted duplicate coach document: deletedCount = ${deleteResult.deletedCount}`);
    } else {
      console.log(`\n4. [DRY RUN] Would delete duplicate coach document (_id: ${DUPLICATE_COACH_ID})`);
    }
  }

  // 5. Verification
  console.log("\n5. Verification Summary:");
  const remainingDuplicateCoaches = await db.collection("coaches").find({ _id: DUPLICATE_COACH_ID }).toArray();
  const allHanaCoaches = await db.collection("coaches").find({ coachName: { $regex: /^hana abaza$/i } }).toArray();
  const remainingScheduled = await db.collection("scheduledclasses").countDocuments({ coachId: DUPLICATE_COACH_ID });
  const totalPrimaryScheduled = await db.collection("scheduledclasses").countDocuments({ coachId: PRIMARY_COACH_ID });

  console.log(`  - Hana Abaza records in 'coaches' collection: ${allHanaCoaches.length} ${isApply ? "(Expected: 1)" : ""}`);
  for (const c of allHanaCoaches) {
    console.log(`      * _id: ${c._id}, name: "${c.coachName}", userId: ${c.userId}`);
  }
  console.log(`  - Scheduled classes referencing duplicate coach: ${remainingScheduled} ${isApply ? "(Expected: 0)" : ""}`);
  console.log(`  - Scheduled classes referencing primary coach:   ${totalPrimaryScheduled} ${isApply ? "(Expected: 125)" : ""}`);

  console.log(`\n======================================================================`);
  if (isApply) {
    console.log(" ✅ MIGRATION COMPLETED SUCCESSFULLY!");
  } else {
    console.log(" ℹ️  DRY RUN COMPLETED. No database changes were made.");
    console.log(" To execute this migration, re-run with: --apply");
  }
  console.log(`======================================================================\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
