import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import path from "path";

// Load environment variables (supports dotenv_config_path or defaults to dev.env)
const envFile = process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../dev.env");
dotenv.config({ path: envFile });

const MONGO_URI = process.env.MONGO_URI;

interface OrphanDetails {
  pkgId: string;
  name: string;
  category: string;
  numberOfSessions: number;
  expiryPeriod: number;
  price: number;
  membersCount: number;
  paymentsCount: number;
}

// Known mapping of deleted legacy package IDs to their original names/details
const KNOWN_ORPHAN_METADATA: Record<string, Partial<OrphanDetails>> = {
  "69e78ecdc824630af7941229": {
    name: "20 Personal Training with Salma Ghazzawi",
    category: "PERSONAL_TRAINING",
    numberOfSessions: 20,
    expiryPeriod: 60,
    price: 10000,
  },
  "69e78ecdc824630af7941226": {
    name: "10 Personal Training with Salma Ghazzawi",
    category: "PERSONAL_TRAINING",
    numberOfSessions: 10,
    expiryPeriod: 30,
    price: 5500,
  },
  "69e78ed1c824630af7941253": {
    name: "10 Personal Training with Nour Rashad",
    category: "PERSONAL_TRAINING",
    numberOfSessions: 10,
    expiryPeriod: 30,
    price: 5500,
  },
};

export async function healOrphanedPackages(isDryRun: boolean = true): Promise<OrphanDetails[]> {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set in environment");
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection not established");
  }

  const membersCol = db.collection("members");
  const packagesCol = db.collection("packages");
  const paymentsCol = db.collection("payments");

  // 1. Get all existing catalog package IDs
  const existingPackages = await packagesCol.find({}, { projection: { _id: 1, name: 1 } }).toArray();
  const existingPkgIdSet = new Set<string>(existingPackages.map((p) => p._id.toString()));

  // 2. Scan members for distinct pkgIds
  const members = await membersCol.find({}).toArray();
  const orphanMap = new Map<string, OrphanDetails>();

  for (const member of members) {
    const pkgs = member.packages || [];
    for (const pkg of pkgs) {
      if (!pkg || !pkg.pkgId) continue;
      const pkgIdStr = pkg.pkgId.toString();
      if (!Types.ObjectId.isValid(pkgIdStr)) continue;

      if (!existingPkgIdSet.has(pkgIdStr)) {
        if (!orphanMap.has(pkgIdStr)) {
          // Attempt to deduce name from adjustment history, ptAttendance, payments, or known metadata
          let deducedName = KNOWN_ORPHAN_METADATA[pkgIdStr]?.name;
          if (!deducedName && Array.isArray(pkg.adjustmentHistory)) {
            for (const adj of pkg.adjustmentHistory) {
              if (adj?.className && typeof adj.className === "string") {
                deducedName = adj.className;
                break;
              }
            }
          }

          if (!deducedName && Array.isArray(member.ptAttendance)) {
            for (const att of member.ptAttendance) {
              if (att?.pkgId?.toString() === pkgIdStr && att?.className) {
                deducedName = att.className;
                break;
              }
            }
          }

          orphanMap.set(pkgIdStr, {
            pkgId: pkgIdStr,
            name: deducedName || `Legacy PT Package (${pkgIdStr.slice(-6)})`,
            category: KNOWN_ORPHAN_METADATA[pkgIdStr]?.category || "PERSONAL_TRAINING",
            numberOfSessions: KNOWN_ORPHAN_METADATA[pkgIdStr]?.numberOfSessions || 10,
            expiryPeriod: KNOWN_ORPHAN_METADATA[pkgIdStr]?.expiryPeriod || 60,
            price: KNOWN_ORPHAN_METADATA[pkgIdStr]?.price || 0,
            membersCount: 1,
            paymentsCount: 0,
          });
        } else {
          const entry = orphanMap.get(pkgIdStr)!;
          entry.membersCount++;
        }
      }
    }
  }

  // 3. Scan payments for orphan pkgIds and deduce names if still missing
  for (const orphanId of orphanMap.keys()) {
    const orphanEntry = orphanMap.get(orphanId)!;
    const payments = await paymentsCol.find({
      pkgId: new Types.ObjectId(orphanId),
    }).toArray();

    orphanEntry.paymentsCount = payments.length;
    if (orphanEntry.name.startsWith("Legacy PT Package") && payments.length > 0) {
      for (const p of payments) {
        if (p.packageName && typeof p.packageName === "string") {
          orphanEntry.name = p.packageName;
          break;
        }
        if (p.note && typeof p.note === "string") {
          orphanEntry.name = p.note;
          break;
        }
      }
    }
  }

  const orphans = Array.from(orphanMap.values());

  console.log(`\nFound ${orphans.length} orphaned package ID(s) requiring archived catalog placeholders:`);
  for (const orphan of orphans) {
    const formattedName = orphan.name.endsWith("(Archived)")
      ? orphan.name
      : `${orphan.name} (Archived)`;

    console.log(`\n  • ID: ${orphan.pkgId}`);
    console.log(`    Name: "${formattedName}"`);
    console.log(`    Category: ${orphan.category} | Sessions: ${orphan.numberOfSessions} | Expiry: ${orphan.expiryPeriod}d`);
    console.log(`    Referenced in: ${orphan.membersCount} member subscriptions | ${orphan.paymentsCount} payments`);

    if (!isDryRun) {
      await packagesCol.updateOne(
        { _id: new Types.ObjectId(orphan.pkgId) },
        {
          $setOnInsert: {
            _id: new Types.ObjectId(orphan.pkgId),
            name: formattedName,
            category: orphan.category,
            numberOfSessions: orphan.numberOfSessions,
            expiryPeriod: orphan.expiryPeriod,
            price: orphan.price,
            isDeprecated: true,
            hidden: true,
            opensClasses: [],
            classRestrictions: [],
          },
        },
        { upsert: true }
      );
      console.log(`    ✅ Inserted archived placeholder into catalog.`);
    }
  }

  if (isDryRun) {
    console.log("\n[DRY RUN] No database writes were performed. Run with --apply to insert archived placeholders.");
  } else {
    console.log(`\n[APPLIED] Successfully seeded ${orphans.length} archived package placeholders.`);
  }

  return orphans;
}

// Direct CLI execution
if (require.main === module) {
  const isApply = process.argv.includes("--apply");
  healOrphanedPackages(!isApply)
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error("Error healing orphaned packages:", err);
      process.exit(1);
    });
}
