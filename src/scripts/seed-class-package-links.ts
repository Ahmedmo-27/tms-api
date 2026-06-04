/**
 * seed-class-package-links.ts
 *
 * 1. Creates missing classes (Stretch and Release)
 * 2. Fixes Prenatal Yoga category → STUDIO
 * 3. Strips null entries from all packages' opensClasses
 * 4. Wires opensClasses on every package per the mapping below
 * 5. Sets Reformer Pilates classRestriction (limit=2) on all UMS packages
 *
 * Idempotent — safe to re-run.
 * Run from tms_api/: npx ts-node src/scripts/seed-class-package-links.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";
import Package from "../models/package";

// ─── Missing classes to create ───────────────────────────────────────────────

const CLASSES_TO_CREATE = [
  { title: "Stretch and Release", category: "STUDIO", price: 500, points: 1 },
];

// ─── Category fixes ──────────────────────────────────────────────────────────

const CATEGORY_FIXES: Record<string, string> = {
  "Prenatal Yoga": "STUDIO",
};

// ─── Package name aliases ────────────────────────────────────────────────────

const ST      = ["5 Studio", "10 Studio", "15 Studio"];
const ST_MIX  = ["Spacer Mix (Functional Training + Studio)", "Spacer Mix (Studio + Space)"];
const FT      = ["10 Functional Training", "20 Functional Training", "30 Functional Training", "50 Functional Training"];
const FT_MIX  = ["Spacer Mix (Functional Training + Space)", "Spacer Mix (Functional Training + Studio)"];
const UMS     = ["1 Month Ultimate Mindspacer", "3 Month Ultimate Mindspacer", "6 Month Ultimate Mindspacer", "12 Month Ultimate Mindspacer"];
const PRE     = ["6 Prenatal", "8 Prenatal", "10 Prenatal"];

// ─── Class title → package names ─────────────────────────────────────────────

const CLASS_TO_PACKAGES: Record<string, string[]> = {
  // STUDIO
  "Mat Pilates":         [...ST, ...ST_MIX, ...UMS],
  "Reformer Pilates":    ["10 Studio", "15 Studio", ...UMS],
  "Mat Sculpt":          [...ST, ...ST_MIX, ...UMS],
  "Stretch and Release": [...ST, ...ST_MIX, ...UMS],
  "Prenatal Yoga":       [...ST, ...ST_MIX, ...UMS],
  "Rope Flow":           [...ST, ...ST_MIX, ...UMS],
  "50 & Fab":            [...ST, ...ST_MIX, ...UMS],

  // FUNCTIONAL TRAINING
  "Strength (Quads, Back, Shoulders)":     [...FT, ...FT_MIX, ...UMS],
  "Strength (Hams, Glutes, Chest & Arms)": [...FT, ...FT_MIX, ...UMS],
  "Strength (Full Body)":                  [...FT, ...FT_MIX, ...UMS],
  "Strength (Hyrox)":                      [...FT, ...FT_MIX, ...UMS],
  "Conditioning (Intervals)":              [...FT, ...FT_MIX, ...UMS],
  "Conditioning (Circuit)":                [...FT, ...FT_MIX, ...UMS],
  "Conditioning (Hyrox)":                  [...FT, ...FT_MIX, ...UMS],
  "Ladies Workout":                        [...FT, ...FT_MIX, ...UMS],

  // PRE/POST NATAL
  "Prenatal":           [...PRE],
  "Postpartum Advanced":[...PRE],
};

const REFORMER_UMS_LIMIT = 2;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  // 1. Create missing classes
  console.log("\n── Step 1: Create missing classes ──────────────────────────");
  for (const cls of CLASSES_TO_CREATE) {
    const existing = await Class.findOne({ title: cls.title });
    if (existing) {
      console.log(`[SKIP]    ${cls.title} — already exists`);
    } else {
      await Class.create({ ...cls, locations: [] });
      console.log(`[CREATED] ${cls.title}`);
    }
  }

  // 2. Fix categories
  console.log("\n── Step 2: Fix class categories ─────────────────────────────");
  for (const [title, newCategory] of Object.entries(CATEGORY_FIXES)) {
    const cls = await Class.findOne({ title });
    if (!cls) {
      console.warn(`[WARN]    "${title}" not found`);
      continue;
    }
    if (cls.category === newCategory) {
      console.log(`[SKIP]    ${title} — already ${newCategory}`);
    } else {
      await Class.updateOne({ _id: cls._id }, { $set: { category: newCategory } });
      console.log(`[FIXED]   ${title}: ${cls.category} → ${newCategory}`);
    }
  }

  // 3. Strip nulls from all packages
  console.log("\n── Step 3: Strip null opensClasses entries ──────────────────");
  const allPackages = await Package.find({}).lean();
  for (const pkg of allPackages) {
    const cleaned = (pkg.opensClasses ?? []).filter((id: any) => id != null);
    if (cleaned.length !== (pkg.opensClasses ?? []).length) {
      await Package.updateOne({ _id: pkg._id }, { $set: { opensClasses: cleaned } });
      console.log(`[CLEANED] ${pkg.name} — removed ${(pkg.opensClasses.length - cleaned.length)} null(s)`);
    }
  }

  // Reload packages after null cleanup
  const packages = await Package.find({}).lean();
  const packageByName = new Map(packages.map((p) => [p.name, p]));

  // Build class title → ObjectId map (after creates)
  const allClasses = await Class.find({}, "_id title").lean();
  const classIdByTitle = new Map<string, Types.ObjectId>(
    allClasses.map((c) => [c.title, c._id as Types.ObjectId])
  );

  // 4. Wire opensClasses
  console.log("\n── Step 4: Wire class→package links ─────────────────────────");
  const opensClassesPatch = new Map<string, Set<string>>();

  for (const [classTitle, pkgNames] of Object.entries(CLASS_TO_PACKAGES)) {
    const classId = classIdByTitle.get(classTitle);
    if (!classId) {
      console.warn(`[WARN]    Class not found: "${classTitle}"`);
      continue;
    }
    for (const pkgName of pkgNames) {
      if (!packageByName.has(pkgName)) {
        console.warn(`[WARN]    Package not found: "${pkgName}"`);
        continue;
      }
      if (!opensClassesPatch.has(pkgName)) opensClassesPatch.set(pkgName, new Set());
      opensClassesPatch.get(pkgName)!.add(classId.toString());
    }
  }

  for (const [pkgName, newClassIds] of opensClassesPatch) {
    const pkg = packageByName.get(pkgName)!;
    const existingIds = new Set((pkg.opensClasses ?? []).map((id: any) => id.toString()));
    const toAdd = [...newClassIds].filter((id) => !existingIds.has(id));

    if (toAdd.length === 0) {
      console.log(`[SKIP]    ${pkgName} — already up to date`);
      continue;
    }

    const merged = [
      ...(pkg.opensClasses ?? []),
      ...toAdd.map((id) => new Types.ObjectId(id)),
    ];
    await Package.updateOne({ _id: pkg._id }, { $set: { opensClasses: merged } });
    console.log(`[UPDATED] ${pkgName} — +${toAdd.length} class(es)`);
  }

  // 5. Reformer Pilates UMS restriction
  console.log("\n── Step 5: Reformer Pilates UMS restriction (limit=2) ────────");
  const reformerId = classIdByTitle.get("Reformer Pilates");
  if (!reformerId) {
    console.warn('[WARN] "Reformer Pilates" not found — skipping');
  } else {
    for (const pkgName of UMS) {
      const pkg = packageByName.get(pkgName);
      if (!pkg) continue;
      const restrictions: { cid: Types.ObjectId; limit: number }[] = (pkg.classRestrictions as any) ?? [];
      const existing = restrictions.find((r) => r.cid.toString() === reformerId.toString());
      if (existing?.limit === REFORMER_UMS_LIMIT) {
        console.log(`[SKIP]    ${pkgName} — restriction already set`);
        continue;
      }
      const updated = [
        ...restrictions.filter((r) => r.cid.toString() !== reformerId.toString()),
        { cid: reformerId, limit: REFORMER_UMS_LIMIT },
      ];
      await Package.updateOne({ _id: pkg._id }, { $set: { classRestrictions: updated } });
      console.log(`[UPDATED] ${pkgName} — Reformer limit=${REFORMER_UMS_LIMIT}`);
    }
  }

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
