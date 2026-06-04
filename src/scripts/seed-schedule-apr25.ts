/**
 * seed-schedule-apr25.ts
 *
 * Seeds ScheduledClasses for the week of April 26 – May 2, 2026.
 *
 * Slot rules:
 *   - Hana Rashwan's classes → 30 slots
 *   - Reformer Pilates        →  4 slots
 *   - Everything else         → 25 slots
 *
 * Run from tms_api/:
 *   npx ts-node src/scripts/seed-schedule-apr25.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../prod.env") });

import mongoose from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";
import Coach from "../models/coach";
import ScheduledClass from "../models/scheduledClass";
import Schedule from "../models/schedule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Date for a Cairo local time (Egypt is EEST = UTC+3 in April/May). */
const dt = (date: string, h: number, m = 0): Date =>
  new Date(
    `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`
  );

const DATES = {
  SUN: "2026-04-26",
  MON: "2026-04-27",
  TUE: "2026-04-28",
  WED: "2026-04-29",
  THU: "2026-04-30",
  FRI: "2026-05-01",
  SAT: "2026-05-02",
};

// ---------------------------------------------------------------------------
// New multi-coach entries to create (findOrCreate by coachName)
// ---------------------------------------------------------------------------

const MULTI_COACHES = [
  "Hana Abaza & Jomana",
  "Salma & Jomana",
  "Salma & HanaKh.",
  "Salma & Omar",
  "Shoukry & Jomana",
  "Asser & Jomana",
  "Hana Kh. & Jomana",
  "Salma / Zeina Z",
];

// ---------------------------------------------------------------------------
// Schedule entries
// [date, startHour, startMin, classTitle, coachName, availableSlots]
// ---------------------------------------------------------------------------

interface Entry {
  date: string;
  h: number;
  m: number;
  title: string;
  coach: string;
  slots: number;
}

const ENTRIES: Entry[] = [
  // ── SUNDAY Apr 25 ────────────────────────────────────────────────────────
  // Studio
  { date: DATES.SUN, h: 9,  m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  { date: DATES.SUN, h: 19, m: 0,  title: "Mat Pilates",                        coach: "Lowgine",             slots: 25 },
  // Functional
  { date: DATES.SUN, h: 7,  m: 30, title: "Strength (Quads, Back, Shoulders)",  coach: "Hana Abaza & Jomana", slots: 25 },
  { date: DATES.SUN, h: 9,  m: 0,  title: "Strength (Quads, Back, Shoulders)",  coach: "Salma & Jomana",      slots: 25 },
  { date: DATES.SUN, h: 10, m: 15, title: "Ladies Workout",                     coach: "Moura",               slots: 25 },
  { date: DATES.SUN, h: 19, m: 0,  title: "Strength (Quads, Back, Shoulders)",  coach: "Hana Abaza & Jomana", slots: 25 },
  { date: DATES.SUN, h: 20, m: 0,  title: "Strength (Quads, Back, Shoulders)",  coach: "Shoukry",             slots: 25 },

  // ── MONDAY Apr 26 ────────────────────────────────────────────────────────
  // Studio
  { date: DATES.MON, h: 8,  m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  { date: DATES.MON, h: 11, m: 0,  title: "50 & Fab",                           coach: "Salma Ghazzawi",      slots: 25 },
  { date: DATES.MON, h: 18, m: 0,  title: "Mat Pilates",                        coach: "Randa",               slots: 25 },
  { date: DATES.MON, h: 19, m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  { date: DATES.MON, h: 20, m: 0,  title: "Rope Flow",                          coach: "Aboseif",             slots: 25 },
  { date: DATES.MON, h: 20, m: 0,  title: "Prenatal Yoga",                      coach: "Mahi",                slots: 25 },
  // Functional
  { date: DATES.MON, h: 7,  m: 30, title: "Conditioning (Intervals)",           coach: "Zeina Tarek",         slots: 25 },
  { date: DATES.MON, h: 9,  m: 0,  title: "Conditioning (Intervals)",           coach: "Hana Khaled",         slots: 25 },
  { date: DATES.MON, h: 19, m: 0,  title: "Conditioning (Hyrox)",               coach: "Zeina Zidan",         slots: 25 },
  { date: DATES.MON, h: 20, m: 0,  title: "Conditioning (Intervals)",           coach: "Shoukry & Jomana",    slots: 25 },

  // ── TUESDAY Apr 27 ───────────────────────────────────────────────────────
  // Studio
  { date: DATES.TUE, h: 9,  m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  { date: DATES.TUE, h: 10, m: 30, title: "Reformer Pilates",                   coach: "Hana Rashwan",        slots: 4  },
  { date: DATES.TUE, h: 17, m: 45, title: "Reformer Pilates",                   coach: "Randa",               slots: 4  },
  { date: DATES.TUE, h: 19, m: 0,  title: "Mat Pilates",                        coach: "Lowgine",             slots: 25 },
  // Functional
  { date: DATES.TUE, h: 10, m: 15, title: "Ladies Workout",                          coach: "Moura",           slots: 25 },
  { date: DATES.TUE, h: 7,  m: 30, title: "Strength (Hams, Glutes, Chest & Arms)", coach: "Hana Abaza",      slots: 25 },
  { date: DATES.TUE, h: 9,  m: 0,  title: "Strength (Hams, Glutes, Chest & Arms)", coach: "Salma & HanaKh.", slots: 25 },
  { date: DATES.TUE, h: 19, m: 0,  title: "Strength (Hams, Glutes, Chest & Arms)", coach: "Omar ElAlamy",    slots: 25 },
  { date: DATES.TUE, h: 20, m: 0,  title: "Strength (Hams, Glutes, Chest & Arms)", coach: "Asser",           slots: 25 },

  // ── WEDNESDAY Apr 28 ─────────────────────────────────────────────────────
  // Studio
  { date: DATES.WED, h: 8,  m: 0,  title: "Mat Pilates",                        coach: "Randa",               slots: 25 },
  { date: DATES.WED, h: 11, m: 0,  title: "50 & Fab",                           coach: "Salma Ghazzawi",      slots: 25 },
  { date: DATES.WED, h: 17, m: 45, title: "Reformer Pilates",                   coach: "Randa",               slots: 4  },
  { date: DATES.WED, h: 19, m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  { date: DATES.WED, h: 20, m: 0,  title: "Mat Pilates",                        coach: "Hana Rashwan",        slots: 30 },
  // Functional
  { date: DATES.WED, h: 7,  m: 30, title: "Conditioning (Intervals)",           coach: "Zeina Tarek",         slots: 25 },
  { date: DATES.WED, h: 9,  m: 0,  title: "Conditioning (Intervals)",           coach: "Hana Khaled",         slots: 25 },
  { date: DATES.WED, h: 19, m: 0,  title: "Conditioning (Hyrox)",               coach: "Zeina Zidan",         slots: 25 },
  { date: DATES.WED, h: 20, m: 0,  title: "Conditioning (Intervals)",           coach: "Asser & Jomana",      slots: 25 },

  // ── THURSDAY Apr 29 ──────────────────────────────────────────────────────
  // Studio
  { date: DATES.THU, h: 9,  m: 0,  title: "Mat Pilates",                        coach: "Randa",               slots: 25 },
  { date: DATES.THU, h: 10, m: 30, title: "Reformer Pilates",                   coach: "Randa",               slots: 4  },
  // Functional
  { date: DATES.THU, h: 7,  m: 30, title: "Strength (Full Body)",               coach: "Zeina Tarek",         slots: 25 },
  { date: DATES.THU, h: 9,  m: 0,  title: "Strength (Full Body)",               coach: "Salma & Omar",        slots: 25 },
  { date: DATES.THU, h: 10, m: 15, title: "Ladies Workout",                     coach: "Moura",               slots: 25 },
  { date: DATES.THU, h: 19, m: 0,  title: "Strength (Full Body)",               coach: "Shoukry",             slots: 25 },

  // ── FRIDAY Apr 30 ────────────────────────────────────────────────────────
  // Studio
  { date: DATES.FRI, h: 12, m: 0,  title: "Mat Pilates",                        coach: "Lowgine",             slots: 25 },
  // Functional
  { date: DATES.FRI, h: 10, m: 30, title: "Conditioning (Circuit)",             coach: "Hana Kh. & Jomana",  slots: 25 },

  // ── SATURDAY May 1 ───────────────────────────────────────────────────────
  // Studio
  { date: DATES.SAT, h: 10, m: 0,  title: "50 & Fab",                           coach: "Hana Abaza",          slots: 25 },
  { date: DATES.SAT, h: 12, m: 0,  title: "Mat Pilates",                        coach: "Randa",               slots: 25 },
  { date: DATES.SAT, h: 19, m: 0,  title: "Rope Flow",                          coach: "Aboseif",             slots: 25 },
  // Functional
  { date: DATES.SAT, h: 11, m: 0,  title: "Conditioning (Hyrox)",               coach: "Salma / Zeina Z",     slots: 25 },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await connectDB();

  // 1. Ensure multi-coach entries exist
  console.log("\n── Creating multi-coach entries ──");
  for (const name of MULTI_COACHES) {
    const existing = await Coach.findOne({ coachName: name });
    if (existing) {
      console.log(`[SKIP]    ${name}`);
    } else {
      await Coach.create({ coachName: name, phoneNumber: "00000000000" });
      console.log(`[CREATED] ${name}`);
    }
  }

  // 2. Build lookup maps
  const allClasses = await Class.find();
  const classMap = new Map(allClasses.map((c) => [c.title, (c._id as mongoose.Types.ObjectId).toString()]));

  const allCoaches = await Coach.find();
  const coachMap = new Map(allCoaches.map((c) => [c.coachName, (c._id as mongoose.Types.ObjectId).toString()]));

  // 3. Seed scheduled classes
  console.log("\n── Seeding scheduled classes ──");
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of ENTRIES) {
    const cid = classMap.get(entry.title);
    if (!cid) {
      const msg = `[ERROR] Class not found: "${entry.title}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    const coachId = coachMap.get(entry.coach);
    if (!coachId) {
      const msg = `[ERROR] Coach not found: "${entry.coach}"`;
      console.error(msg);
      errors.push(msg);
      continue;
    }

    const startTime = dt(entry.date, entry.h, entry.m);
    const endTime   = dt(entry.date, entry.h + 1, entry.m); // all classes are 1 hour

    const duplicate = await ScheduledClass.findOne({ cid, startTime });
    if (duplicate) {
      console.log(`[SKIP]    ${entry.date} ${entry.h}:${String(entry.m).padStart(2,"0")} — ${entry.title} (${entry.coach})`);
      skipped++;
      continue;
    }

    const scheduledClass = await ScheduledClass.create({
      cid,
      startTime,
      endTime,
      availableSlots: entry.slots,
      coachId,
      bookedMembers: [],
      scans: [],
    });

    // Use UTC midnight so dates match what the API server (running in UTC) expects.
    // Schedule.scheduleClass() uses toLocaleDateString() which is timezone-dependent.
    const dayStart = new Date(startTime);
    dayStart.setUTCHours(0, 0, 0, 0);
    await Schedule.findOneAndUpdate(
      { date: dayStart },
      { $addToSet: { classes: scheduledClass._id } },
      { upsert: true }
    );

    console.log(
      `[CREATED] ${entry.date} ${String(entry.h).padStart(2,"0")}:${String(entry.m).padStart(2,"0")} ` +
      `— ${entry.title.padEnd(40)} | ${entry.coach.padEnd(25)} | ${entry.slots} slots`
    );
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Errors: ${errors.length}`);
  if (errors.length) {
    console.log("\nErrors:");
    errors.forEach((e) => console.log(" ", e));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
