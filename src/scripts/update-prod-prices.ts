import dotenv from "dotenv";
import path from "path";
import mongoose, { Types } from "mongoose";
import Package from "../models/package";
import Coach from "../models/coach";
import Class from "../models/class";

interface UpdateAction {
  type: "UPDATE_CLASS" | "UPDATE_PACKAGE" | "DEPRECATE_PACKAGE" | "CREATE_PACKAGE";
  id?: string;
  name: string;
  changes: Record<string, unknown>;
  reason: string;
}

function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Resolves the canonical Coach entity for a package, either by coachId
 * or by matching coach name/aliases in the package title.
 * Examples: "Salma" -> "Salma Ghazzawi", "Omar El Alamy" -> "Omar ElAlamy"
 */
function resolveCoach(pkg: any, coaches: any[]): any | null {
  if (pkg.coachId) {
    const found = coaches.find(
      (c) => c._id.toString() === pkg.coachId.toString()
    );
    if (found) return found;
  }

  const pkgNameLower = (pkg.name || "").toLowerCase();

  // Known aliases mapping normalized snippet -> coachName in DB
  const aliasMap: Record<string, string> = {
    salma: "Salma Ghazzawi",
    salmaghazzawi: "Salma Ghazzawi",
    omarelalamy: "Omar ElAlamy",
    omarelalamywithspace: "Omar ElAlamy",
    hanaminisy: "Hana Elmeneisy",
    hanaelmeneisy: "Hana Elmeneisy",
    zeinatarek: "Zeina Tarek",
    zeinazidan: "Zeina Zidan",
    hanaabaza: "Hana Abaza",
    hanakhaled: "Hana Khaled",
    shoukry: "Shoukry",
    dana: "Dana",
    haidy: "Haidy",
    mostafa: "Mostafa Khaled",
    mostafakhaled: "Mostafa Khaled",
    toqa: "Toqa",
    nourrashad: "Nour Rashad",
    moura: "Moura",
    lujain: "Lujain",
    asser: "Asser",
    youssef: "Youssef Khaled",
    youssefkhaled: "Youssef Khaled",
  };

  for (const [alias, canonicalName] of Object.entries(aliasMap)) {
    if (pkgNameLower.includes(alias)) {
      const match = coaches.find(
        (c) => normalizeKey(c.coachName) === normalizeKey(canonicalName)
      );
      if (match) return match;
    }
  }

  // Try matching any coach by normalized name or first name
  for (const coach of coaches) {
    const coachNorm = normalizeKey(coach.coachName);
    const firstName = normalizeKey(coach.coachName.split(" ")[0]);

    if (normalizeKey(pkgNameLower).includes(coachNorm)) {
      return coach;
    }
    // Match first name if unique (at least 4 chars to avoid false positives)
    if (firstName.length >= 4 && normalizeKey(pkgNameLower).includes(firstName)) {
      const matches = coaches.filter(
        (c) => normalizeKey(c.coachName.split(" ")[0]) === firstName
      );
      if (matches.length === 1) {
        return coach;
      }
    }
  }

  return null;
}

async function main() {
  const isApply = process.argv.includes("--apply");
  const isProd = !process.argv.includes("--dev");
  const envFile = isProd ? "prod.env" : "dev.env";
  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`❌ MONGO_URI not found in ${envFile}!`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(` PRICE LIST & DUPLICATE RESOLUTION SCRIPT [${isApply ? "🚀 APPLY MODE" : "🔍 DRY RUN (NO CHANGES)"}]`);
  console.log(` Target Environment: ${envFile}`);
  console.log(`======================================================\n`);

  await mongoose.connect(uri);

  const actions: UpdateAction[] = [];
  const coaches = await Coach.find({}).lean();

  // =========================================================================
  // 1. DROP-IN CLASSES
  // Rule: Functional Training below 500 -> 500
  //       Studio below 550 -> 550
  //       Drop-ins 550+ stay exactly as they are!
  // =========================================================================
  console.log("--- 1. Evaluating Drop-in Classes ---");
  const allClasses = await Class.find({}).lean();

  for (const c of allClasses) {
    const title = (c as any).title;
    const price = (c as any).price;
    const cat = (c as any).category;

    if (price >= 550) {
      // Retain all drop-ins 550+ as instructed by user
      continue;
    }

    if (cat === "FUNCTIONAL_TRAINING" && price < 500) {
      actions.push({
        type: "UPDATE_CLASS",
        id: c._id.toString(),
        name: title,
        changes: { price: 500 },
        reason: `Functional Training drop-in below 500 EGP (${price} -> 500 EGP)`,
      });
    } else if (cat === "STUDIO" && price < 550) {
      actions.push({
        type: "UPDATE_CLASS",
        id: c._id.toString(),
        name: title,
        changes: { price: 550 },
        reason: `Studio drop-in below 550 EGP (${price} -> 550 EGP)`,
      });
    }
  }

  // =========================================================================
  // 2. SPACE MEMBERSHIP PACKAGES
  // Price List:
  //   1 Month: 3,000 EGP (1 week freeze = 7d, 30d expiry)
  //   3 Months: 7,200 EGP (2 weeks freeze = 14d, 90d expiry)
  //   6 Months: 12,500 EGP (3 weeks freeze = 21d, 180d expiry)
  //   1 Year: 20,500 EGP (6 weeks freeze = 42d, 365d expiry)
  // =========================================================================
  console.log("--- 2. Evaluating Space Membership Packages ---");
  const space1m = await Package.findById("6a47f348b71a5d31d730e735").lean();
  if (space1m) {
    const targetName = "1 Month Space Membership";
    if (space1m.price !== 3000 || space1m.name !== targetName || space1m.allowedFreezeDays !== 7 || space1m.hidden || space1m.isDeprecated) {
      actions.push({
        type: "UPDATE_PACKAGE",
        id: space1m._id.toString(),
        name: space1m.name,
        changes: { name: targetName, price: 3000, allowedFreezeDays: 7, hidden: false, isDeprecated: false },
        reason: "Update 1 Month Space Membership to 3,000 EGP & 7d freeze, unhide",
      });
    }
  }

  const space3m = await Package.findById("6a47f557b71a5d31d7339d24").lean();
  if (space3m) {
    const targetName = "3 Months Space Membership";
    if (space3m.price !== 7200 || space3m.name !== targetName || space3m.allowedFreezeDays !== 14 || space3m.hidden || space3m.isDeprecated) {
      actions.push({
        type: "UPDATE_PACKAGE",
        id: space3m._id.toString(),
        name: space3m.name,
        changes: { name: targetName, price: 7200, allowedFreezeDays: 14, hidden: false, isDeprecated: false },
        reason: "Update 3 Months Space Membership to 7,200 EGP & 14d freeze, unhide",
      });
    }
  }

  const space6m = await Package.findById("6a47f558b71a5d31d733d99c").lean();
  if (space6m) {
    const targetName = "6 Months Space Membership";
    if (space6m.price !== 12500 || space6m.name !== targetName || space6m.allowedFreezeDays !== 21 || space6m.hidden || space6m.isDeprecated) {
      actions.push({
        type: "UPDATE_PACKAGE",
        id: space6m._id.toString(),
        name: space6m.name,
        changes: { name: targetName, price: 12500, allowedFreezeDays: 21, hidden: false, isDeprecated: false },
        reason: "Update 6 Months Space Membership to 12,500 EGP & 21d freeze, unhide",
      });
    }
  }

  const space1y = await Package.findById("6a47f559b71a5d31d73410d9").lean();
  if (space1y) {
    const targetName = "1 Year Space Membership";
    if (space1y.price !== 20500 || space1y.name !== targetName || space1y.expiryPeriod !== 365 || space1y.allowedFreezeDays !== 42 || space1y.hidden || space1y.isDeprecated) {
      actions.push({
        type: "UPDATE_PACKAGE",
        id: space1y._id.toString(),
        name: space1y.name,
        changes: { name: targetName, price: 20500, expiryPeriod: 365, allowedFreezeDays: 42, hidden: false, isDeprecated: false },
        reason: "Update 1 Year Space Membership to 20,500 EGP & 42d freeze, unhide",
      });
    }
  }

  // Deprecate obsolete/duplicate space packages so no one can purchase at old prices
  const obsoleteSpacePkgIds = [
    { id: "6a4382572ba8878c291be549", name: "1 Month Space Membership New Cairo (duplicate)" },
    { id: "6a47a96bb71a5d31d722f92e", name: "Space membership La Vista bay" },
    { id: "6a4375c32ba8878c291927b1", name: "Whole Summer Space" },
    { id: "6a3c196b3661ee212b42d808", name: "The Ultimate Mind Spacer 1 Week" },
    { id: "6a3c19833661ee212b42d898", name: "The Ultimate Mind Spacer 2 Weeks" },
    { id: "6a3c19c33661ee212b42da46", name: "The Ultimate Mind Spacer 1 Month (Old Summer 9800 EGP)" },
    { id: "6a3c19dc3661ee212b42dad6", name: "The Ultimate Mind Spacer Whole Summer" },
    { id: "69e53352408d558187798191", name: "30 Functional Training (obsolete tier 7900 EGP)" },
    { id: "69e78ed7c824630af7941295", name: "20 Personal Training with Dana (duplicate hidden)" },
    { id: "69e78ed7c824630af7941298", name: "24 Personal Training with Dana (duplicate hidden)" },
    { id: "6ac733cd0a8371edae38b15a", name: "20 PT with Tarek (hidden non-standard 16800 EGP)" },
  ];

  for (const obs of obsoleteSpacePkgIds) {
    const pkg = await Package.findById(obs.id).lean();
    if (pkg && (!pkg.isDeprecated || !pkg.hidden)) {
      actions.push({
        type: "DEPRECATE_PACKAGE",
        id: pkg._id.toString(),
        name: pkg.name,
        changes: { isDeprecated: true, hidden: true },
        reason: `Deprecate obsolete/duplicate package to prevent buying at old price: ${obs.name}`,
      });
    }
  }

  // =========================================================================
  // 3. IN-PERSON PERSONAL TRAINING (Expiry Period Alignments & Duplicates)
  // 10 PT: 5 weeks = 35 days
  // 12 PT: 6 weeks = 42 days
  // 20 PT: 9 weeks = 63 days
  // 24 PT: 11 weeks = 77 days
  // =========================================================================
  console.log("--- 3. Evaluating In-Person Personal Training Packages ---");
  const allActivePackages = await Package.find({ isDeprecated: { $ne: true } }).lean();

  const inPersonPtPackages = allActivePackages.filter(
    (p) =>
      p.category === "PERSONAL_TRAINING" &&
      !p.name.toLowerCase().includes("online") &&
      !p.name.toLowerCase().includes("pre/post") &&
      p.coachId
  );

  // Group by (coachId, numberOfSessions) to catch duplicates
  const inPersonGroups = new Map<string, typeof inPersonPtPackages>();
  for (const p of inPersonPtPackages) {
    const key = `${p.coachId}_${p.numberOfSessions}`;
    if (!inPersonGroups.has(key)) inPersonGroups.set(key, []);
    inPersonGroups.get(key)!.push(p);
  }

  for (const [key, group] of inPersonGroups.entries()) {
    if (group.length > 1) {
      // Pick the primary one (visible or lowest ID), deprecate the others
      const primary = group.find((p) => !p.hidden) || group[0];
      for (const p of group) {
        if (p._id.toString() !== primary._id.toString()) {
          actions.push({
            type: "DEPRECATE_PACKAGE",
            id: p._id.toString(),
            name: p.name,
            changes: { isDeprecated: true, hidden: true },
            reason: `Duplicate in-person PT package detected for same coach (${p.numberOfSessions} sessions). Keeping ${primary._id}.`,
          });
        }
      }
    }

    const pkg = group[0];
    let targetExpiry: number | null = null;
    if (pkg.numberOfSessions === 10) targetExpiry = 35;
    else if (pkg.numberOfSessions === 12) targetExpiry = 42;
    else if (pkg.numberOfSessions === 20) targetExpiry = 63;
    else if (pkg.numberOfSessions === 24) targetExpiry = 77;

    if (targetExpiry && pkg.expiryPeriod !== targetExpiry) {
      actions.push({
        type: "UPDATE_PACKAGE",
        id: pkg._id.toString(),
        name: pkg.name,
        changes: { expiryPeriod: targetExpiry },
        reason: `Align PT expiry with price list: ${pkg.numberOfSessions} sessions should be ${targetExpiry}d (was ${pkg.expiryPeriod}d)`,
      });
    }
  }

  // =========================================================================
  // 4. ONLINE PT: DUPLICATE DETECTION, ALIAS NORMALIZATION, AND TIER LABELING
  //
  // Price List:
  // Standard Tier:
  //   1 Month: 3,800 EGP (31d, 31 sessions)
  //   3 Months: 9,600 EGP (90d, 90 sessions)
  //   6 Months: 16,000 EGP (180d, 180 sessions)
  //
  // Plus Facility Use Tier:
  //   1 Month: 5,600 EGP (31d, 31 sessions)
  //   3 Months: 14,500 EGP (90d, 90 sessions)
  //   6 Months: 25,000 EGP (180d, 180 sessions)
  //
  // Detection cases handled:
  // - "1 month Online PT with Salma" is recognized as Coach "Salma Ghazzawi"
  // - "1 month Online PT with Omar El Alamy" recognized as "Omar ElAlamy"
  // - Differentiates Standard (3800) vs Plus Facility Use (5600) so they are NOT
  //   confused as duplicates, and renames Plus Facility Use to explicitly
  //   include "(Plus Facility Use)" in the package name!
  // - Detects actual multiple packages for the same coach + same duration + same tier,
  //   keeping one and deprecating the rest.
  // =========================================================================
  console.log("--- 4. Evaluating Online PT Packages & Coach Aliases ---");

  const onlinePackages = allActivePackages.filter((p) =>
    p.name.toLowerCase().includes("online")
  );

  type OnlineTier = "STANDARD" | "PLUS_FACILITY_USE" | "UNKNOWN";
  type OnlineDuration = "1M" | "3M" | "6M" | "UNKNOWN";

  function resolveOnlineTier(price: number, name: string): OnlineTier {
    if (price === 5600 || price === 14500 || price === 25000) return "PLUS_FACILITY_USE";
    if (price === 3800 || price === 9600 || price === 16000) return "STANDARD";
    if (name.toLowerCase().includes("facility")) return "PLUS_FACILITY_USE";
    return "UNKNOWN";
  }

  function resolveOnlineDuration(sessions: number, expiry: number, name: string): OnlineDuration {
    const n = name.toLowerCase();
    if (sessions <= 31 && (expiry <= 31 || n.includes("1 month"))) return "1M";
    if (sessions <= 90 && (expiry <= 90 || n.includes("3 month"))) return "3M";
    if (sessions <= 180 && (expiry <= 180 || n.includes("6 month"))) return "6M";
    return "UNKNOWN";
  }

  // Map: coachId -> Map<"TIER_DURATION", Package[]>
  const coachOnlineCatalog = new Map<string, Map<string, typeof onlinePackages>>();

  for (const pkg of onlinePackages) {
    const coach = resolveCoach(pkg, coaches);
    if (!coach) {
      console.warn(`⚠️ Warning: Could not resolve coach for online package: "${pkg.name}" (ID: ${pkg._id})`);
      continue;
    }

    const cId = coach._id.toString();
    if (!coachOnlineCatalog.has(cId)) {
      coachOnlineCatalog.set(cId, new Map());
    }

    const tier = resolveOnlineTier(pkg.price, pkg.name);
    const duration = resolveOnlineDuration(pkg.numberOfSessions, pkg.expiryPeriod, pkg.name);
    const groupKey = `${tier}_${duration}`;

    const tierMap = coachOnlineCatalog.get(cId)!;
    if (!tierMap.has(groupKey)) {
      tierMap.set(groupKey, []);
    }
    tierMap.get(groupKey)!.push(pkg);
  }

  // Process each coach offering Online PT
  for (const [cId, tierMap] of coachOnlineCatalog.entries()) {
    const coach = coaches.find((c) => c._id.toString() === cId);
    const coachName = coach?.coachName || "Coach";

    const tierDefs: {
      tier: OnlineTier;
      duration: OnlineDuration;
      price: number;
      sessions: number;
      expiry: number;
      durationLabel: string;
      isFacility: boolean;
    }[] = [
      { tier: "STANDARD", duration: "1M", price: 3800, sessions: 31, expiry: 31, durationLabel: "1 month", isFacility: false },
      { tier: "STANDARD", duration: "3M", price: 9600, sessions: 90, expiry: 90, durationLabel: "3 months", isFacility: false },
      { tier: "STANDARD", duration: "6M", price: 16000, sessions: 180, expiry: 180, durationLabel: "6 months", isFacility: false },
      { tier: "PLUS_FACILITY_USE", duration: "1M", price: 5600, sessions: 31, expiry: 31, durationLabel: "1 month", isFacility: true },
      { tier: "PLUS_FACILITY_USE", duration: "3M", price: 14500, sessions: 90, expiry: 90, durationLabel: "3 months", isFacility: true },
      { tier: "PLUS_FACILITY_USE", duration: "6M", price: 25000, sessions: 180, expiry: 180, durationLabel: "6 months", isFacility: true },
    ];

    for (const def of tierDefs) {
      const key = `${def.tier}_${def.duration}`;
      const existingInTier = tierMap.get(key) || [];
      const expectedName = def.isFacility
        ? `${def.durationLabel} Online PT with ${coachName} (Plus Facility Use)`
        : `${def.durationLabel} Online PT with ${coachName}`;

      if (existingInTier.length === 0) {
        // Missing tier for this coach -> create it
        actions.push({
          type: "CREATE_PACKAGE",
          name: expectedName,
          changes: {
            name: expectedName,
            category: "PERSONAL_TRAINING",
            price: def.price,
            numberOfSessions: def.sessions,
            expiryPeriod: def.expiry,
            coachId: new Types.ObjectId(cId),
            isDeprecated: false,
            hidden: false,
            opensClasses: [],
          },
          reason: `Create missing ${def.tier} ${def.durationLabel} Online PT (${def.price} EGP) for ${coachName}`,
        });
      } else {
        // Check for duplicates in the same tier
        if (existingInTier.length > 1) {
          // Keep the best matching one (e.g., matching expected name or newer), deprecate extra duplicates
          const primary = existingInTier.find((p) => p.name === expectedName) || existingInTier[0];
          for (const extra of existingInTier) {
            if (extra._id.toString() !== primary._id.toString()) {
              actions.push({
                type: "DEPRECATE_PACKAGE",
                id: extra._id.toString(),
                name: extra.name,
                changes: { isDeprecated: true, hidden: true },
                reason: `Duplicate Online PT package for Coach ${coachName} in ${def.tier} ${def.durationLabel}. Keeping ${primary._id}.`,
              });
            }
          }
        }

        // Canonical package update: ensure name clearly states (Plus Facility Use) if facility tier,
        // uses canonical coach name (e.g. Salma Ghazzawi instead of Salma), and correct coachId
        const canonical = existingInTier[0];
        const changes: Record<string, unknown> = {};

        if (canonical.name !== expectedName) {
          changes.name = expectedName;
        }
        if (canonical.price !== def.price) {
          changes.price = def.price;
        }
        if (!canonical.coachId || canonical.coachId.toString() !== cId) {
          changes.coachId = new Types.ObjectId(cId);
        }
        if (canonical.hidden) {
          changes.hidden = false;
        }
        if (canonical.isDeprecated) {
          changes.isDeprecated = false;
        }

        if (Object.keys(changes).length > 0) {
          actions.push({
            type: "UPDATE_PACKAGE",
            id: canonical._id.toString(),
            name: canonical.name,
            changes,
            reason: `Normalize Online PT package: disambiguate name to "${expectedName}" (was "${canonical.name}") and ensure canonical coachId`,
          });
        }
      }
    }
  }

  // =========================================================================
  // SUMMARY AND EXECUTION
  // =========================================================================
  console.log(`\n=================== PROPOSED ACTIONS SUMMARY ===================`);
  console.log(`Total actions proposed: ${actions.length}`);

  const updateClasses = actions.filter((a) => a.type === "UPDATE_CLASS");
  const updatePackages = actions.filter((a) => a.type === "UPDATE_PACKAGE");
  const deprecatePackages = actions.filter((a) => a.type === "DEPRECATE_PACKAGE");
  const createPackages = actions.filter((a) => a.type === "CREATE_PACKAGE");

  console.log(`- Class Drop-in Price Updates (< 550 EGP only): ${updateClasses.length}`);
  console.log(`- Package Price/Expiry/Name Normalizations: ${updatePackages.length}`);
  console.log(`- Redundant/Obsolete/Duplicate Packages to Deprecate: ${deprecatePackages.length}`);
  console.log(`- Missing Online PT Packages to Create: ${createPackages.length}`);

  console.log(`\n=================== DETAILED ACTIONS ===================`);
  for (const act of actions) {
    console.log(`\n[${act.type}] ${act.name} ${act.id ? `(ID: ${act.id})` : ""}`);
    console.log(`  Reason:  ${act.reason}`);
    console.log(`  Changes: ${JSON.stringify(act.changes)}`);
  }

  if (!isApply) {
    console.log(`\n======================================================`);
    console.log(` [DRY RUN COMPLETED] No changes were written to the database.`);
    console.log(` To apply these updates to PROD, run:`);
    console.log(`   npx ts-node src/scripts/update-prod-prices.ts --apply`);
    console.log(` To apply to TEST/DEV, run:`);
    console.log(`   npx ts-node src/scripts/update-prod-prices.ts --dev --apply`);
    console.log(`======================================================\n`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\n⏳ Applying changes to ${envFile}...`);

  for (const act of actions) {
    if (act.type === "UPDATE_CLASS") {
      await Class.updateOne({ _id: act.id }, { $set: act.changes });
    } else if (act.type === "UPDATE_PACKAGE" || act.type === "DEPRECATE_PACKAGE") {
      await Package.updateOne({ _id: act.id }, { $set: act.changes });
    } else if (act.type === "CREATE_PACKAGE") {
      await Package.create(act.changes);
    }
  }

  console.log(`\n✅ ALL ${actions.length} ACTIONS SUCCESSFULLY APPLIED TO ${envFile}!`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error executing script:", err);
  process.exit(1);
});
