/**
 * seed-coaches.ts
 *
 * Seeds the Coach collection. Skips coaches that already exist by name.
 * Run from tms_api/: npx ts-node src/scripts/seed-coaches.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Coach from "../models/coach";

const COACHES = [
  "Salma Ghazzawi",
  "Nour Rashad",
  "Shoukry",
  "Youssef Khaled",
  "Hana Abaza",
  "Zeina Zidan",
  "Zeina Tarek",
  "Asser",
  "Omar ElAlamy",
  "Hana Khaled",
  "Hana Elmeneisy",
  "Randa",
  "Hana Rashwan",
  "Lowgine",
  "Mahi",
  "Haidy",
  "Dana",
  "Diala",
  "Nouran Amer",
  "Moura",
  "Ghalia",
  "Aboseif",
  "Lujain",
];

async function main() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const name of COACHES) {
    const existing = await Coach.findOne({ coachName: name });
    if (existing) {
      console.log(`[SKIP]    ${name}`);
      skipped++;
      continue;
    }
    await Coach.create({ coachName: name, phoneNumber: "01111111111" });
    console.log(`[CREATED] ${name}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
