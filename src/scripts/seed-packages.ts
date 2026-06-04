/**
 * seed-packages.ts
 *
 * One-time recovery script to seed Package documents.
 * Run from tms_api/: npx ts-node src/scripts/seed-packages.ts
 *
 * TODOs before running:
 *   - Fill in price and expiryPeriod for PRE/POST NATAL packages (marked below)
 *   - Fill in numberOfSessions for Spacer Mix packages (marked below)
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Package from "../models/package";

interface PackageSeed {
  name: string;
  numberOfSessions: number;
  category: string;
  price: number;
  expiryPeriod: number;
}

const packages: PackageSeed[] = [
  // ── STUDIO ───────────────────────────────────────────────────
  {
    name: "5 Studio",
    numberOfSessions: 5,
    category: "STUDIO",
    price: 2250,
    expiryPeriod: 30,
  },
  {
    name: "10 Studio",
    numberOfSessions: 10,
    category: "STUDIO",
    price: 3900,
    expiryPeriod: 60,
  },
  {
    name: "15 Studio",
    numberOfSessions: 15,
    category: "STUDIO",
    price: 5200,
    expiryPeriod: 75,
  },

  // ── FUNCTIONAL TRAINING ──────────────────────────────────────
  {
    name: "10 Functional Training",
    numberOfSessions: 10,
    category: "FUNCTIONAL_TRAINING",
    price: 3500,
    expiryPeriod: 45,
  },
  {
    name: "20 Functional Training",
    numberOfSessions: 20,
    category: "FUNCTIONAL_TRAINING",
    price: 5900,
    expiryPeriod: 75,
  },
  {
    name: "30 Functional Training",
    numberOfSessions: 30,
    category: "FUNCTIONAL_TRAINING",
    price: 7900,
    expiryPeriod: 105,
  },
  {
    name: "50 Functional Training",
    numberOfSessions: 50,
    category: "FUNCTIONAL_TRAINING",
    price: 11000,
    expiryPeriod: 180,
  },

  // ── ULTIMATE MINDSPACER ──────────────────────────────────────
  {
    name: "1 Month Ultimate Mindspacer",
    numberOfSessions: 10000, // unlimited
    category: "ULTIMATE_MINDSPACER",
    price: 5500,
    expiryPeriod: 30,
  },
  {
    name: "3 Month Ultimate Mindspacer",
    numberOfSessions: 10000, // unlimited
    category: "ULTIMATE_MINDSPACER",
    price: 14000,
    expiryPeriod: 90,
  },
  {
    name: "6 Month Ultimate Mindspacer",
    numberOfSessions: 10000, // unlimited
    category: "ULTIMATE_MINDSPACER",
    price: 19950,
    expiryPeriod: 180,
  },
  {
    name: "12 Month Ultimate Mindspacer",
    numberOfSessions: 10000, // unlimited
    category: "ULTIMATE_MINDSPACER",
    price: 31500,
    expiryPeriod: 365,
  },

  // ── SPACER MIX ───────────────────────────────────────────────
  {
    name: "Spacer Mix (Studio + Space)",
    numberOfSessions: 6,
    category: "MIXED",
    price: 4000,
    expiryPeriod: 45,
  },
  {
    name: "Spacer Mix (Functional Training + Space)",
    numberOfSessions: 10,
    category: "MIXED",
    price: 4000,
    expiryPeriod: 45,
  },
  {
    name: "Spacer Mix (Functional Training + Studio)",
    numberOfSessions: 10,
    category: "MIXED",
    price: 4000,
    expiryPeriod: 45,
  },

  // ── PRE/POST NATAL ───────────────────────────────────────────
  {
    name: "6 Prenatal",
    numberOfSessions: 6,
    category: "PRE_POST_NATAL",
    price: 2475,
    expiryPeriod: 28,
  },
  {
    name: "8 Prenatal",
    numberOfSessions: 8,
    category: "PRE_POST_NATAL",
    price: 3000,
    expiryPeriod: 35,
  },
  {
    name: "10 Prenatal",
    numberOfSessions: 10,
    category: "PRE_POST_NATAL",
    price: 3700,
    expiryPeriod: 45,
  },
];

async function seedPackages() {
  // Warn about unfilled TODOs
  const incomplete = packages.filter((p) => p.price === 0 || p.expiryPeriod === 0);
  if (incomplete.length > 0) {
    console.warn("\n⚠️  The following packages have price=0 or expiryPeriod=0 (TODO fields not filled):");
    incomplete.forEach((p) => console.warn(`   - ${p.name}`));
    console.warn("   Fill them in before running, or they will be inserted with 0 values.\n");
  }

  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const pkg of packages) {
    const existing = await Package.findOne({ name: pkg.name });
    if (existing) {
      console.log(`[SKIP]    ${pkg.name}`);
      skipped++;
      continue;
    }
    await Package.create({ ...pkg, opensClasses: [] });
    console.log(`[CREATED] ${pkg.name}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

seedPackages().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
