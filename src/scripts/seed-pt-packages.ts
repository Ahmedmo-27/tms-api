/**
 * seed-pt-packages.ts
 *
 * Creates Personal Training packages — one per (coach × session tier).
 * Naming: "10 Personal Training with Salma Ghazzawi"
 *
 * Senior coaches (higher price): Salma Ghazzawi, Nour Rashad, Dana, Haidy
 * Normal coaches (standard price): everyone else listed below
 *
 * Idempotent — skips packages that already exist by name.
 * Run from tms_api/: npx ts-node src/scripts/seed-pt-packages.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Coach from "../models/coach";
import Package from "../models/package";

// ─── Pricing tiers ───────────────────────────────────────────────────────────

const TIERS = [
  { sessions: 10, expiryPeriod: 30, normalPrice: 5300, seniorPrice: 6300 },
  { sessions: 12, expiryPeriod: 45, normalPrice: 5750, seniorPrice: 6800 },
  { sessions: 20, expiryPeriod: 60, normalPrice: 9000, seniorPrice: 10500 },
  { sessions: 24, expiryPeriod: 75, normalPrice: 10000, seniorPrice: 12000 },
];

const SENIOR_COACHES = new Set([
  "Salma Ghazzawi",
  "Nour Rashad",
  "Dana",
  "Haidy",
]);

const PT_COACHES = new Set([
  // Senior
  "Salma Ghazzawi",
  "Nour Rashad",
  "Dana",
  "Haidy",
  // Normal
  "Shoukry",
  "Asser",
  "Youssef Khaled",
  "Hana Abaza",
  "Lujain",
  "Zeina Zidan",
  "Zeina Tarek",
  "Hana Elmeneisy",
  "Moura",
  "Omar ElAlamy",
]);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  const allCoaches = await Coach.find({}, "_id coachName").lean();
  const ptCoaches = allCoaches.filter((c) => PT_COACHES.has(c.coachName));

  const missing = [...PT_COACHES].filter(
    (name) => !allCoaches.find((c) => c.coachName === name)
  );
  if (missing.length > 0) {
    console.warn("\n⚠️  These PT coaches were not found in DB:");
    missing.forEach((n) => console.warn(`   - ${n}`));
    console.warn();
  }

  console.log(`Creating packages for ${ptCoaches.length} coaches × ${TIERS.length} tiers...\n`);

  let created = 0;
  let skipped = 0;

  for (const coach of ptCoaches) {
    const isSenior = SENIOR_COACHES.has(coach.coachName);
    for (const tier of TIERS) {
      const price = isSenior ? tier.seniorPrice : tier.normalPrice;
      const name = `${tier.sessions} Personal Training with ${coach.coachName}`;

      const existing = await Package.findOne({ name });
      if (existing) {
        console.log(`[SKIP]    ${name}`);
        skipped++;
        continue;
      }

      await Package.create({
        name,
        numberOfSessions: tier.sessions,
        category: "PERSONAL_TRAINING",
        price,
        expiryPeriod: tier.expiryPeriod,
        coachId: coach._id,
        opensClasses: [],
        classRestrictions: [],
      });
      console.log(`[CREATED] ${name} — ${price} EGP / ${tier.expiryPeriod}d [${isSenior ? "SENIOR" : "NORMAL"}]`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
