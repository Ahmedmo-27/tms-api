/**
 * seed-classes.ts
 *
 * Seeds the Class collection. Skips classes that already exist by title.
 * locations is left empty — wire up after seeding locations.
 * Run from tms_api/: npx ts-node src/scripts/seed-classes.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";

const CLASSES = [
  // ── STUDIO ───────────────────────────────────────────────────
  { title: "Mat Pilates",     category: "STUDIO",             price: 500, points: 1 },
  { title: "Reformer Pilates",category: "STUDIO",             price: 785, points: 2 },
  { title: "50 & Fab",        category: "STUDIO",             price: 500, points: 1 },
  { title: "Fusion",          category: "STUDIO",             price: 500, points: 1 },
  { title: "Rope Flow",       category: "STUDIO",             price: 500, points: 1 },

  // ── PRE/POST NATAL ───────────────────────────────────────────
  { title: "Prenatal Yoga",        category: "PRE_POST_NATAL", price: 450, points: 1 },
  { title: "Prenatal",             category: "PRE_POST_NATAL", price: 450, points: 1 },
  { title: "Postpartum Program",   category: "PRE_POST_NATAL", price: 450, points: 1 },
  { title: "Postpartum Advanced",  category: "PRE_POST_NATAL", price: 450, points: 1 },
  { title: "Prenatal/Postpartum",  category: "PRE_POST_NATAL", price: 450, points: 1 },

  // ── FUNCTIONAL TRAINING ──────────────────────────────────────
  { title: "Strength (Quads, Back, Shoulders)",    category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Strength (Hams, Glutes, Chest & Arms)",category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Strength (Full Body)",                 category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Strength (Hyrox)",                     category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Conditioning (Intervals)",category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Conditioning (Circuit)",  category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Conditioning (Hyrox)",    category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
  { title: "Ladies Workout",          category: "FUNCTIONAL_TRAINING", price: 450, points: 1 },
];

async function main() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const cls of CLASSES) {
    const existing = await Class.findOne({ title: cls.title });
    if (existing) {
      console.log(`[SKIP]    ${cls.title}`);
      skipped++;
      continue;
    }
    await Class.create({ ...cls, locations: [] });
    console.log(`[CREATED] ${cls.title.padEnd(20)} | category: ${cls.category.padEnd(22)} | price: ${cls.price} | pts: ${cls.points}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  console.log("Note: locations is empty — run seed:locations and link classes after.");
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
