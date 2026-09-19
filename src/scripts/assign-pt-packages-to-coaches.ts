/**
 * assign-pt-packages-to-coaches.ts
 *
 * Reads unassigned PT packages in production (or dev with --dev),
 * compares package names against coaches to find the matching coach,
 * and assigns coachId.
 *
 * Usage:
 *   Dry-run (preview only, no DB writes):
 *     npx ts-node src/scripts/assign-pt-packages-to-coaches.ts
 *
 *   Apply changes to production:
 *     npx ts-node src/scripts/assign-pt-packages-to-coaches.ts --apply
 *
 *   Only assign active (non-archived) packages:
 *     npx ts-node src/scripts/assign-pt-packages-to-coaches.ts --apply --active-only
 *
 *   Target dev environment instead of prod:
 *     npx ts-node src/scripts/assign-pt-packages-to-coaches.ts --dev
 */

import dotenv from "dotenv";
import path from "path";
import mongoose, { Types } from "mongoose";

// ─── Environment Selection ────────────────────────────────────────────────────

const isDev = process.argv.includes("--dev");
const envFile = isDev ? "dev.env" : "prod.env";
const envPath = path.join(__dirname, `../../${envFile}`);

dotenv.config({ path: envPath });

const isApply = process.argv.includes("--apply");
const isDryRun = !isApply || process.argv.includes("--dry-run");
const activeOnly = process.argv.includes("--active-only");

// ─── Coach Alias Mapping ──────────────────────────────────────────────────────

const ALIAS_MAP: Record<string, string> = {
  "youssef": "Youssef Khaled",
  "hana minisy": "Hana Elmeneisy",
  "hana minissy": "Hana Elmeneisy",
  "salma": "Salma Ghazzawi",
  "omar el alamy": "Omar ElAlamy",
  "omar elalamy": "Omar ElAlamy",
  "omar alamy": "Omar ElAlamy",
};

interface ICoachDoc {
  _id: Types.ObjectId;
  coachName: string;
  phoneNumber?: string;
  userId?: Types.ObjectId;
}

interface IPackageDoc {
  _id: Types.ObjectId;
  name: string;
  category: string;
  price?: number;
  numberOfSessions?: number;
  isDeprecated?: boolean;
  hidden?: boolean;
  coachId?: Types.ObjectId | null;
}

interface MatchResult {
  pkg: IPackageDoc;
  matchedCoach: ICoachDoc | null;
  rule: string;
  reason?: string;
}

// ─── Matcher Function ─────────────────────────────────────────────────────────

function matchCoachForPackage(
  pkgName: string,
  coaches: ICoachDoc[],
  coachByNameMap: Map<string, ICoachDoc>
): { coach: ICoachDoc; rule: string } | null {
  const normPkg = pkgName.toLowerCase().trim();

  // 1. Longest coach name substring match (e.g. "Zeina Tarek" matches before "Zeina")
  for (const coach of coaches) {
    const cName = coach.coachName.toLowerCase().trim();
    if (cName.length < 3) continue;

    // Check boundary or substring
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegExp(cName)}([^a-z0-9]|$)`, "i");
    if (regex.test(normPkg) || normPkg.includes(cName)) {
      const resolved = coachByNameMap.get(coach.coachName.toLowerCase()) || coach;
      return { coach: resolved, rule: `EXACT_NAME (${coach.coachName})` };
    }
  }

  // 2. Whitespace-normalized match (e.g. "Omar El Alamy" vs "Omar ElAlamy")
  const noSpacePkg = normPkg.replace(/\s+/g, "");
  for (const coach of coaches) {
    const noSpaceCoach = coach.coachName.toLowerCase().replace(/\s+/g, "");
    if (noSpaceCoach.length < 3) continue;

    if (noSpacePkg.includes(noSpaceCoach)) {
      const resolved = coachByNameMap.get(coach.coachName.toLowerCase()) || coach;
      return { coach: resolved, rule: `SPACE_NORMALIZED (${coach.coachName})` };
    }
  }

  // 3. Known PT aliases & short names
  for (const [alias, targetCoachName] of Object.entries(ALIAS_MAP)) {
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, "i");
    if (regex.test(normPkg)) {
      const resolved = coachByNameMap.get(targetCoachName.toLowerCase());
      if (resolved) {
        return { coach: resolved, rule: `ALIAS (${alias} -> ${targetCoachName})` };
      }
    }
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
}

// ─── Main Script ──────────────────────────────────────────────────────────────

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error(`❌ MONGO_URI is not set in ${envFile}!`);
    process.exit(1);
  }

  console.log("==========================================================");
  console.log("   PT PACKAGES -> COACH ASSIGNMENT UTILITY");
  console.log("==========================================================");
  console.log(`Target Environment : ${envFile.toUpperCase()}`);
  console.log(`Database Connection: ${maskMongoUri(mongoUri)}`);
  console.log(`Execution Mode     : ${isDryRun ? "DRY-RUN (Preview Only)" : "⚡ APPLY (Writing to DB)"}`);
  if (activeOnly) {
    console.log(`Filter             : Active packages only (--active-only)`);
  }
  console.log("----------------------------------------------------------\n");

  const conn = await mongoose.createConnection(mongoUri).asPromise();
  const db = conn.db;
  if (!db) {
    throw new Error("Could not acquire database handle from connection.");
  }

  try {
    // 1. Fetch Coaches
    const rawCoaches = (await db.collection("coaches").find({}).toArray()) as unknown as ICoachDoc[];
    console.log(`Loaded ${rawCoaches.length} coaches from database.`);

    // Build deduplicated name map prioritizing coaches with linked userId
    const coachByNameMap = new Map<string, ICoachDoc>();
    for (const c of rawCoaches) {
      const key = c.coachName.trim().toLowerCase();
      if (!coachByNameMap.has(key)) {
        coachByNameMap.set(key, c);
      } else {
        const existing = coachByNameMap.get(key)!;
        if (!existing.userId && c.userId) {
          coachByNameMap.set(key, c); // Prefer the one with a registered user account
        }
      }
    }

    // Sort coaches by name length descending for matching priority
    const sortedCoaches = [...rawCoaches].sort(
      (a, b) => b.coachName.length - a.coachName.length
    );

    // 2. Fetch Unassigned PT Packages
    const packageQuery: Record<string, unknown> = {
      $or: [
        { coachId: null },
        { coachId: { $exists: false } },
      ],
      $and: [
        {
          $or: [
            { category: "PERSONAL_TRAINING" },
            { name: { $regex: /pt|personal training/i } },
          ],
        },
      ],
    };

    if (activeOnly) {
      packageQuery.isDeprecated = { $ne: true };
    }

    const unassignedPkgs = (await db
      .collection("packages")
      .find(packageQuery)
      .sort({ isDeprecated: 1, name: 1 })
      .toArray()) as unknown as IPackageDoc[];

    console.log(`Found ${unassignedPkgs.length} unassigned PT packages.\n`);

    if (unassignedPkgs.length === 0) {
      console.log("✅ No unassigned PT packages found. Nothing to do.");
      return;
    }

    // 3. Match each package against coaches
    const matchResults: MatchResult[] = [];

    for (const pkg of unassignedPkgs) {
      const match = matchCoachForPackage(pkg.name, sortedCoaches, coachByNameMap);
      if (match) {
        matchResults.push({
          pkg,
          matchedCoach: match.coach,
          rule: match.rule,
        });
      } else {
        matchResults.push({
          pkg,
          matchedCoach: null,
          rule: "UNMATCHED",
          reason: "No matching coach name or alias found in package title",
        });
      }
    }

    const matched = matchResults.filter((r) => r.matchedCoach !== null);
    const unmatched = matchResults.filter((r) => r.matchedCoach === null);

    const activeMatched = matched.filter((m) => !m.pkg.isDeprecated);
    const archivedMatched = matched.filter((m) => !!m.pkg.isDeprecated);

    // 4. Print Comparison Table
    console.log("==========================================================");
    console.log("              MATCH & COMPARISON REPORT");
    console.log("==========================================================\n");

    console.log(`--- [ACTIVE PACKAGES MATCHED: ${activeMatched.length}] ---`);
    for (const item of activeMatched) {
      console.log(
        `• [ID: ${item.pkg._id}] "${item.pkg.name}"\n` +
        `  Sessions: ${item.pkg.numberOfSessions ?? "N/A"} | Price: ${item.pkg.price ?? "N/A"} EGP\n` +
        `  -> Assigned Coach: "${item.matchedCoach!.coachName}" (ID: ${item.matchedCoach!._id})\n` +
        `  -> Match Rule    : ${item.rule}\n`
      );
    }

    if (archivedMatched.length > 0) {
      console.log(`--- [ARCHIVED / DEPRECATED PACKAGES MATCHED: ${archivedMatched.length}] ---`);
      for (const item of archivedMatched) {
        console.log(
          `• [ID: ${item.pkg._id}] "${item.pkg.name}" (Archived)\n` +
          `  -> Assigned Coach: "${item.matchedCoach!.coachName}" (ID: ${item.matchedCoach!._id})\n` +
          `  -> Match Rule    : ${item.rule}\n`
        );
      }
    }

    if (unmatched.length > 0) {
      console.log(`--- [UNMATCHED PACKAGES (SKIPPED): ${unmatched.length}] ---`);
      for (const item of unmatched) {
        console.log(
          `• [ID: ${item.pkg._id}] "${item.pkg.name}" (Archived: ${!!item.pkg.isDeprecated})\n` +
          `  -> Reason: ${item.reason}\n`
        );
      }
    }

    // Summary per coach
    console.log("----------------------------------------------------------");
    console.log("SUMMARY BY COACH:");
    const summaryByCoach: Record<string, { active: number; archived: number; total: number }> = {};
    for (const item of matched) {
      const cName = item.matchedCoach!.coachName;
      if (!summaryByCoach[cName]) {
        summaryByCoach[cName] = { active: 0, archived: 0, total: 0 };
      }
      if (item.pkg.isDeprecated) {
        summaryByCoach[cName].archived++;
      } else {
        summaryByCoach[cName].active++;
      }
      summaryByCoach[cName].total++;
    }

    console.table(
      Object.entries(summaryByCoach).map(([coachName, counts]) => ({
        "Coach Name": coachName,
        "Active Pkgs": counts.active,
        "Archived Pkgs": counts.archived,
        "Total to Assign": counts.total,
      }))
    );

    console.log(`Total Unassigned Found : ${unassignedPkgs.length}`);
    console.log(`Total Ready to Assign  : ${matched.length} (${activeMatched.length} active, ${archivedMatched.length} archived)`);
    console.log(`Total Skipped / Unmatch: ${unmatched.length}\n`);

    // 5. Apply or Dry-Run Exit
    if (isDryRun) {
      console.log("==========================================================");
      console.log("ℹ️  DRY RUN COMPLETE — No database modifications were made.");
      console.log("To apply these coach assignments to the database, run:");
      console.log("   npm run assign-pt-coaches:apply");
      console.log("   (or: npx ts-node src/scripts/assign-pt-packages-to-coaches.ts --apply)");
      console.log("==========================================================");
      return;
    }

    // Perform updates
    console.log("⚡ APPLYING UPDATES TO DATABASE...");
    let updatedCount = 0;

    for (const item of matched) {
      const res = await db.collection("packages").updateOne(
        { _id: item.pkg._id },
        {
          $set: {
            coachId: new Types.ObjectId(item.matchedCoach!._id),
          },
        }
      );

      if (res.modifiedCount > 0) {
        updatedCount++;
      }
    }

    console.log(`\n✅ Successfully updated ${updatedCount} / ${matched.length} packages with their respective coach IDs!`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error("❌ Script failed with error:", err);
  process.exit(1);
});
