/**
 * audit-manual-waitlist-promotions.ts
 *
 * READ-ONLY database audit script.
 * Finds all members who were added manually to the waitlist (isManual: true)
 * and got into classes by promotion (or booked upon notification).
 *
 * For each promoted entry, it verifies:
 *   1. Did their package actually have a session deducted from it?
 *   2. If not deducted, did they have an active package that could have covered it,
 *      or were they promoted as a silent Walk-In without payment?
 *   3. Was a payment record created for a drop-in / walk-in?
 *
 * CLI Usage:
 *   npm run audit:manual-waitlist
 *   npx ts-node src/scripts/audit-manual-waitlist-promotions.ts --month=2026-10
 *   npx ts-node src/scripts/audit-manual-waitlist-promotions.ts --coach="hana rashwan"
 *   npx ts-node src/scripts/audit-manual-waitlist-promotions.ts --csv=promoted-waitlist-audit.csv
 *   npx ts-node src/scripts/audit-manual-waitlist-promotions.ts --status=not-deducted
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose, { Types } from "mongoose";
import User from "../models/user";
import Member from "../models/member";
import Package from "../models/package";
import Class from "../models/class";
import ScheduledClass from "../models/scheduledClass";
import Payment from "../models/payment";
import Coach from "../models/coach";
import Location from "../models/location";
import WaitlistEntry from "../models/waitlistEntry";
import { selectEligiblePackage, type EligibilityPackage } from "../utils/package-eligibility";
import { formatInTimeZone } from "date-fns-tz";

const CAIRO_TZ = "Africa/Cairo";

export interface PromotionAuditRow {
  sessionDate: string;
  className: string;
  category: string;
  coaches: string;
  branch: string;
  memberName: string;
  phone: string;
  waitlistMode: string;
  waitlistStatus: string;
  bookingStatus: string;
  bookedMethod: string;
  scanStatus: string;
  sessionDeducted: "YES" | "NO";
  deductionDetails: string;
  packageOnAccountStatus: string;
  paymentStatus: string;
  paidAmount: string;
  auditNote: string;
}

async function runAudit() {
  const envArg = process.argv.find((a) => a.startsWith("--env="))?.split("=")[1] || "prod";
  const envFile = envArg === "dev" ? "dev.env" : "prod.env";
  const envPath = path.resolve(process.cwd(), envFile);

  console.log(`[Audit] Loading environment from ${envPath}...`);
  dotenv.config({ path: envPath });

  const customUri = process.argv.find((a) => a.startsWith("--uri="))?.split("=")[1];
  const mongoUri = customUri || process.env.MONGO_URI;

  if (!mongoUri) {
    console.error("[Audit Error] No MONGO_URI found in environment or arguments.");
    process.exit(1);
  }

  console.log("[Audit] Connecting to database (READ-ONLY mode)...");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log("[Audit] Connected successfully!\n");

  // Load catalogs into memory
  const [classes, packages, coaches, locations] = await Promise.all([
    Class.find().lean(),
    Package.find().lean(),
    Coach.find().lean(),
    Location.find().lean(),
  ]);

  const classMap = new Map<string, any>(classes.map((c: any) => [c._id.toString(), c]));
  const packageMap = new Map<string, any>(packages.map((p: any) => [p._id.toString(), p]));
  const coachMap = new Map<string, string>(coaches.map((c: any) => [c._id.toString(), c.coachName]));
  const locationMap = new Map<string, string>(
    locations.map((l: any) => [l._id.toString(), l.branchName || l.location || "Cairo"]),
  );

  // Map each classId to allowed package IDs
  const classToAllowedPackages = new Map<string, string[]>();
  for (const pkg of packages) {
    const pkgId = pkg._id.toString();
    for (const cid of (pkg as any).opensClasses || []) {
      const cidStr = cid.toString();
      const existing = classToAllowedPackages.get(cidStr) || [];
      existing.push(pkgId);
      classToAllowedPackages.set(cidStr, existing);
    }
  }

  // CLI Filters
  const monthArg = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];
  const fromArg = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
  const toArg = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
  const daysArg = process.argv.find((a) => a.startsWith("--days="))?.split("=")[1];
  const coachFilter = process.argv.find((a) => a.startsWith("--coach="))?.split("=")[1]?.toLowerCase();
  const categoryFilter = process.argv.find((a) => a.startsWith("--category="))?.split("=")[1]?.toUpperCase();
  const statusFilter = process.argv.find((a) => a.startsWith("--status="))?.split("=")[1]?.toLowerCase();
  const csvArg = process.argv.find((a) => a.startsWith("--csv="))?.split("=")[1];

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (monthArg && /^\d{4}-\d{2}$/.test(monthArg)) {
    const [year, month] = monthArg.split("-").map(Number);
    startDate = new Date(Date.UTC(year, month - 1, 1));
    endDate = new Date(Date.UTC(year, month, 1));
  } else if (fromArg) {
    startDate = new Date(fromArg);
    endDate = toArg ? new Date(toArg) : new Date();
  } else if (daysArg && !isNaN(Number(daysArg))) {
    const days = Number(daysArg);
    startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    endDate = new Date();
  }

  const timeFrameLabel = startDate && endDate
    ? `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`
    : startDate
    ? `From ${startDate.toISOString().slice(0, 10)} onwards`
    : "ALL TIME (Entire history)";

  console.log(`[Audit] Time Frame: ${timeFrameLabel}`);
  if (coachFilter) console.log(`[Audit] Coach filter: "${coachFilter}"`);
  if (categoryFilter) console.log(`[Audit] Category filter: "${categoryFilter}"`);
  if (statusFilter) console.log(`[Audit] Status filter: "${statusFilter}"`);

  console.log("\n[Audit] Finding all manual waitlist promotions...");

  // 1. Query WaitlistEntry where isManual: true
  const waitlistQuery: Record<string, any> = { isManual: true };
  const manualWaitlistEntries = await WaitlistEntry.find(waitlistQuery).sort({ createdAt: -1 }).lean();
  console.log(`[Audit] Found ${manualWaitlistEntries.length} total manual waitlist entries.`);

  // Group by sessionId
  const sessionToWaitlistMap = new Map<string, any[]>();
  for (const entry of manualWaitlistEntries) {
    const sid = entry.sessionId.toString();
    const list = sessionToWaitlistMap.get(sid) || [];
    list.push(entry);
    sessionToWaitlistMap.set(sid, list);
  }

  // 2. Fetch corresponding scheduled classes
  const sessionObjectIds = Array.from(sessionToWaitlistMap.keys()).map((id) => new Types.ObjectId(id));
  const classFilterQuery: Record<string, any> = { _id: { $in: sessionObjectIds } };
  if (startDate || endDate) {
    classFilterQuery.startTime = {};
    if (startDate) classFilterQuery.startTime.$gte = startDate;
    if (endDate) classFilterQuery.startTime.$lte = endDate;
  }

  const scheduledClasses = await ScheduledClass.find(classFilterQuery).sort({ startTime: -1 }).lean();
  console.log(`[Audit] Matching scheduled classes in timeframe: ${scheduledClasses.length}\n`);

  const auditRows: PromotionAuditRow[] = [];

  for (const sc of scheduledClasses) {
    const scid = sc._id.toString();
    const classInfo = classMap.get((sc.cid as any)?.toString() || "");
    const className = classInfo?.title || "Unknown Class";
    const category = classInfo?.category || "Unknown";
    const branch = sc.locationId ? locationMap.get(sc.locationId.toString()) || "Cairo" : "Cairo";
    const sessionTime = new Date(sc.startTime);
    const dateFormatted = formatInTimeZone(sessionTime, CAIRO_TZ, "yyyy-MM-dd HH:mm");

    const coachNames = Array.isArray(sc.coachId)
      ? sc.coachId.map((id: any) => coachMap.get(id?.toString()) || "Coach").join(", ")
      : coachMap.get((sc.coachId as any)?.toString()) || "Coach";

    if (coachFilter && !coachNames.toLowerCase().includes(coachFilter)) continue;
    if (categoryFilter && category.toUpperCase() !== categoryFilter) continue;

    const allowedPkgIds = classInfo ? classToAllowedPackages.get(classInfo._id.toString()) || [] : [];
    const waitlistEntriesForSession = sessionToWaitlistMap.get(scid) || [];

    for (const wlEntry of waitlistEntriesForSession) {
      const uid = wlEntry.userId.toString();

      // Check if this member got into the class (in bookedMembers or scans)
      const bookedMember = (sc.bookedMembers || []).find(
        (b: any) => (b.uid?._id ? b.uid._id.toString() : b.uid?.toString()) === uid
      );
      const scanRecord = (sc.scans || []).find(
        (s: any) => ((s.uid as any)?._id?.toString() || s.uid?.toString()) === uid
      );

      // Only audit members who were promoted / got into the class
      const gotIntoClass = Boolean(bookedMember || scanRecord || wlEntry.status === "BOOKED");
      if (!gotIntoClass) {
        continue;
      }

      const [user, member, payment] = await Promise.all([
        User.findById(uid).select("name phoneNumber email").lean(),
        Member.findOne({ uid: new Types.ObjectId(uid) }).lean(),
        Payment.findOne({
          uid: new Types.ObjectId(uid),
          scid: new Types.ObjectId(scid),
          isRefunded: false,
        }).lean(),
      ]);

      const memberName = user?.name || "Unknown Member";
      const phone = user?.phoneNumber || "N/A";
      const bookedMethod = bookedMember?.method || (scanRecord?.method ? String(scanRecord.method) : "N/A");

      let scanStatus = "NO_SCAN";
      if (scanRecord) {
        scanStatus = scanRecord.status === true
          ? "SUCCESS"
          : scanRecord.status === false
          ? "FAILED"
          : String(scanRecord.status);
      }

      let bookingStatus = "Booked";
      if (scanRecord?.status === true) {
        bookingStatus = "Attended (Scanned)";
      } else if (!bookedMember && !scanRecord) {
        bookingStatus = "Cancelled / Removed";
      }

      // Check Member's booking record for this class
      const memberBookingRecord = (member?.bookings || []).find(
        (b: any) => b.scid?.toString() === scid
      );

      // Verify if a package session was deducted
      const isWalkInMethod = /^(walk in|waitlist confirmed)$/i.test(bookedMethod.trim());
      const isDropInBooking = Boolean(memberBookingRecord?.isDropIn || bookedMethod.toLowerCase() === "drop in");
      const isPackageMethod = Boolean(!isWalkInMethod && !isDropInBooking && bookedMethod !== "N/A");

      let sessionDeducted: "YES" | "NO" = "NO";
      let deductionDetails = "";
      let packageOnAccountStatus = "";
      let auditNote = "";

      if (isPackageMethod && memberBookingRecord && !memberBookingRecord.isDropIn) {
        sessionDeducted = "YES";
        const pkgName = bookedMethod;
        const matchedPkg = (member?.packages || []).find(
          (p: any) => p.name === pkgName || (scanRecord?.pkgId && p.pkgId?.toString() === scanRecord.pkgId.toString())
        );
        const rem = matchedPkg?.remainingClasses ?? "N/A";
        deductionDetails = `Deducted from "${pkgName}" (${rem} classes remaining on package)`;
        packageOnAccountStatus = `Active package "${pkgName}" was charged by Member.saveBooking`;
        auditNote = "OK: Session deducted correctly via package.";
      } else {
        sessionDeducted = "NO";
        deductionDetails = `NOT DEDUCTED: Recorded as "${bookedMethod}" (isDropIn: ${isDropInBooking})`;

        // Check if member had an active package that COULD have covered it
        if (member && Array.isArray(member.packages) && member.packages.length > 0) {
          const eligibilityInput: EligibilityPackage[] = member.packages.map((p: any) => ({
            pkgId: p.pkgId?.toString(),
            name: p.name,
            status: p.status,
            pkgStartDate: p.pkgStartDate,
            pkgEndDate: p.pkgEndDate,
            remainingClasses: p.remainingClasses ?? 0,
            classRestrictionsRecord: p.classRestrictionsRecord,
          }));

          const elResult = selectEligiblePackage({
            packages: eligibilityInput,
            allowedPkgIds,
            cid: classInfo?._id.toString(),
            now: sessionTime,
          });

          if (elResult.ok) {
            packageOnAccountStatus = `MISSED DEDUCTION: Active package "${elResult.pkg.name}" (${elResult.pkg.remainingClasses} left) was available but NOT deducted!`;
            auditNote = "CRITICAL: Member had active package, but was booked as walk-in without deducting session!";
          } else {
            packageOnAccountStatus = `No eligible package at session time (${elResult.code})`;
            if (payment) {
              auditNote = "OK: Paid drop-in collected (Member had no eligible package).";
            } else {
              auditNote = "CRITICAL: Promoted without package AND without payment (Silent Unpaid Walk-in)!";
            }
          }
        } else {
          packageOnAccountStatus = "No packages on member account";
          if (payment) {
            auditNote = "OK: Paid drop-in collected (Member has no package).";
          } else {
            auditNote = "CRITICAL: Promoted without package AND without payment (Silent Unpaid Walk-in)!";
          }
        }
      }

      // Payment details
      let paymentStatus = "NO PAYMENT";
      let paidAmount = "EGP 0";
      if (payment) {
        paymentStatus = (payment as any).isRefunded ? "REFUNDED" : "PAID";
        paidAmount = `EGP ${payment.amount ?? 0}`;
      }

      // Apply status filter if provided
      if (statusFilter === "deducted" && sessionDeducted !== "YES") continue;
      if (statusFilter === "not-deducted" && sessionDeducted !== "NO") continue;

      auditRows.push({
        sessionDate: dateFormatted,
        className,
        category,
        coaches: coachNames,
        branch,
        memberName,
        phone,
        waitlistMode: "Manual",
        waitlistStatus: wlEntry.status,
        bookingStatus,
        bookedMethod,
        scanStatus,
        sessionDeducted,
        deductionDetails,
        packageOnAccountStatus,
        paymentStatus,
        paidAmount,
        auditNote,
      });
    }
  }

  // Summary statistics
  const totalPromotions = auditRows.length;
  const deductedCount = auditRows.filter((r) => r.sessionDeducted === "YES").length;
  const notDeductedCount = auditRows.filter((r) => r.sessionDeducted === "NO").length;
  const unpaidCount = auditRows.filter((r) => r.sessionDeducted === "NO" && r.paymentStatus === "NO PAYMENT").length;
  const paidDropInCount = auditRows.filter((r) => r.sessionDeducted === "NO" && r.paymentStatus !== "NO PAYMENT").length;

  console.log("=".repeat(100));
  console.log("   MANUAL WAITLIST PROMOTIONS & PACKAGE DEDUCTION AUDIT REPORT");
  console.log("=".repeat(100));
  console.log(`Total Manual Waitlist Entries Promoted into Classes: ${totalPromotions}`);
  console.log(`  - Package Session Successfully Deducted:           ${deductedCount} (${totalPromotions ? Math.round((deductedCount / totalPromotions) * 100) : 0}%)`);
  console.log(`  - NO Package Session Deducted:                     ${notDeductedCount} (${totalPromotions ? Math.round((notDeductedCount / totalPromotions) * 100) : 0}%)`);
  console.log(`      * Paid Drop-Ins (Payment verified):            ${paidDropInCount}`);
  console.log(`      * UNPAID Walk-Ins (Zero payment & no package): ${unpaidCount}`);
  console.log("=".repeat(100) + "\n");

  if (auditRows.length === 0) {
    console.log("No manual waitlist promotions found matching the given filters.");
  } else {
    // Print formatted summary table
    console.log(
      "Date / Time       | Class            | Member Name         | Deducted? | Booked Method | Scan Status | Payment    | Audit Note"
    );
    console.log("-".repeat(125));
    for (const r of auditRows) {
      const d = r.sessionDate.padEnd(17);
      const c = r.className.slice(0, 16).padEnd(16);
      const m = r.memberName.slice(0, 19).padEnd(19);
      const ded = (r.sessionDeducted === "YES" ? "[YES]" : "[NO]").padEnd(9);
      const bm = r.bookedMethod.slice(0, 13).padEnd(13);
      const ss = r.scanStatus.slice(0, 11).padEnd(11);
      const ps = (r.paymentStatus === "NO PAYMENT" ? "UNPAID" : r.paidAmount).padEnd(10);
      const note = r.auditNote.slice(0, 30);
      console.log(`${d} | ${c} | ${m} | ${ded} | ${bm} | ${ss} | ${ps} | ${note}`);
    }
    console.log("-".repeat(125) + "\n");
  }

  // Export CSV if requested
  if (csvArg) {
    const csvPath = path.resolve(process.cwd(), csvArg);
    console.log(`[Audit] Exporting full report to CSV: ${csvPath}...`);
    const headers = [
      "Session Date",
      "Class Name",
      "Category",
      "Coaches",
      "Branch",
      "Member Name",
      "Phone",
      "Waitlist Mode",
      "Waitlist Status",
      "Booking Status",
      "Booked Method",
      "Scan Status",
      "Session Deducted from Package?",
      "Deduction Details",
      "Package On Account Status",
      "Payment Status",
      "Paid Amount",
      "Audit Note",
    ];

    const escapeCsv = (val: string) => `"${(val || "").replace(/"/g, '""')}"`;
    const rows = auditRows.map((r) => [
      escapeCsv(r.sessionDate),
      escapeCsv(r.className),
      escapeCsv(r.category),
      escapeCsv(r.coaches),
      escapeCsv(r.branch),
      escapeCsv(r.memberName),
      escapeCsv(r.phone),
      escapeCsv(r.waitlistMode),
      escapeCsv(r.waitlistStatus),
      escapeCsv(r.bookingStatus),
      escapeCsv(r.bookedMethod),
      escapeCsv(r.scanStatus),
      escapeCsv(r.sessionDeducted),
      escapeCsv(r.deductionDetails),
      escapeCsv(r.packageOnAccountStatus),
      escapeCsv(r.paymentStatus),
      escapeCsv(r.paidAmount),
      escapeCsv(r.auditNote),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    fs.writeFileSync(csvPath, csvContent, "utf8");
    console.log(`[Audit] CSV successfully exported with ${auditRows.length} rows!\n`);
  }

  await mongoose.disconnect();
  console.log("[Audit] Database disconnected cleanly.");
}

runAudit().catch((err) => {
  console.error("[Audit Error] Fatal failure:", err);
  process.exit(1);
});
