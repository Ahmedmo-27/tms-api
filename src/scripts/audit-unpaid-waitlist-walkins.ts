/**
 * audit-unpaid-waitlist-walkins.ts
 *
 * READ-ONLY database audit script.
 * Finds all member class bookings and scans that were recorded as "Walk In" / "Waitlist Confirmed"
 * (e.g. from the silent waitlist promotion fallback).
 *
 * For each incident, it checks:
 *   1. Did the member have an active package that could have covered that session at that time?
 *   2. Or should they have paid for a walk-in / drop-in because they had no valid package?
 *   3. Was any payment ever recorded for that member and session?
 *
 * Usage:
 *   npx ts-node src/scripts/audit-unpaid-waitlist-walkins.ts
 *   npx ts-node src/scripts/audit-unpaid-waitlist-walkins.ts --env=prod
 *   npx ts-node src/scripts/audit-unpaid-waitlist-walkins.ts --csv=report.csv
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
import { selectEligiblePackage, type EligibilityPackage } from "../utils/package-eligibility";
import { formatInTimeZone } from "date-fns-tz";

const CAIRO_TZ = "Africa/Cairo";

interface AuditRow {
  sessionDate: string;
  className: string;
  category: string;
  coaches: string;
  branch: string;
  memberName: string;
  phone: string;
  bookingMethod: string;
  scanStatus: string;
  paymentStatus: string;
  paidAmount: string;
  hasCoveringPackage: "YES (Could be covered)" | "NO (Should have paid walk-in)";
  packageReason: string;
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

  // Load catalogs into memory for fast lookup
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
    locations.map((l: any) => [l._id.toString(), l.branchName || l.location || "Main"]),
  );

  // Map each classId to the list of package IDs that open it
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

  // Parse CLI filtering arguments
  const fromArg = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
  const toArg = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
  const monthArg = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];
  const daysArg = process.argv.find((a) => a.startsWith("--days="))?.split("=")[1];
  const coachFilter = process.argv.find((a) => a.startsWith("--coach="))?.split("=")[1]?.toLowerCase();
  const categoryFilter = process.argv.find((a) => a.startsWith("--category="))?.split("=")[1]?.toUpperCase();

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

  const query: Record<string, any> = {
    $or: [
      { "bookedMembers.method": { $regex: /^(walk in|waitlist confirmed)$/i } },
      { "scans.method": { $regex: /^(walk in|waitlist confirmed)$/i } },
    ],
  };

  if (startDate || endDate) {
    query.startTime = {};
    if (startDate) query.startTime.$gte = startDate;
    if (endDate) query.startTime.$lte = endDate;
  }

  const timeFrameLabel = startDate && endDate
    ? `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`
    : startDate
    ? `From ${startDate.toISOString().slice(0, 10)} onwards`
    : "ALL TIME (Entire database history)";

  console.log(`[Audit] Time Frame: ${timeFrameLabel}`);
  if (coachFilter) console.log(`[Audit] Coach filter: "${coachFilter}"`);
  if (categoryFilter) console.log(`[Audit] Category filter: "${categoryFilter}"`);
  console.log("[Audit] Scanning scheduled classes for member 'Walk In' records...");

  // Find all matching scheduled classes
  const scheduledClasses = await ScheduledClass.find(query)
    .sort({ startTime: -1 })
    .lean();

  console.log(`[Audit] Found ${scheduledClasses.length} sessions with Walk-In / Waitlist Confirmed records.\n`);

  const auditRows: AuditRow[] = [];

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

    // Identify target members in bookedMembers or scans
    const candidateUids = new Set<string>();

    for (const b of sc.bookedMembers || []) {
      if (b.method && /^(walk in|waitlist confirmed)$/i.test(b.method.trim())) {
        candidateUids.add(b.uid.toString());
      }
    }
    for (const s of sc.scans || []) {
      const scanUid = (s.uid as any)?._id?.toString() || s.uid?.toString();
      if (scanUid && s.method && /^(walk in|waitlist confirmed)$/i.test(s.method.trim())) {
        candidateUids.add(scanUid);
      }
    }

    for (const uid of candidateUids) {
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
      const phone = user?.phoneNumber || "";

      // Find booking entry & scan entry
      const bookingEntry = (sc.bookedMembers || []).find((b: any) => b.uid.toString() === uid);
      const scanEntry = (sc.scans || []).find(
        (s: any) => ((s.uid as any)?._id?.toString() || s.uid?.toString()) === uid,
      );

      const bookingMethod = bookingEntry?.method || scanEntry?.method || "Walk In";
      const scanStatus =
        scanEntry?.status === true
          ? "SUCCESS (Attended)"
          : scanEntry?.status === false
          ? "FAILED"
          : String(scanEntry?.status || "NOT_SCANNED");

      let paymentStatus = "NO PAYMENT RECORDED";
      let paidAmount = "0";
      if (payment) {
        paymentStatus = `PAID (${payment.paymentMethod || "UNKNOWN"})`;
        paidAmount = String(payment.amount || 0);
      }

      // Check package eligibility at the time of the session
      let hasCoveringPackage: AuditRow["hasCoveringPackage"] = "NO (Should have paid walk-in)";
      let packageReason = "No packages on member profile";

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

        const result = selectEligiblePackage({
          packages: eligibilityInput,
          allowedPkgIds,
          cid: classInfo?._id.toString(),
          now: sessionTime,
        });

        if (result.ok) {
          hasCoveringPackage = "YES (Could be covered)";
          packageReason = `Active "${result.pkg.name}" (${result.pkg.remainingClasses} sessions remaining)`;
        } else {
          switch (result.code) {
            case "NO_REMAINING_SESSIONS":
              packageReason = `Package "${result.context?.packageName || "Studio"}" has 0 remaining sessions`;
              break;
            case "PACKAGE_EXPIRED":
              packageReason = `Package "${result.context?.packageName || "Studio"}" expired on ${result.context?.date || "earlier"}`;
              break;
            case "PACKAGE_FROZEN":
              packageReason = `Package "${result.context?.packageName || "Studio"}" was frozen`;
              break;
            case "NO_PACKAGES_ON_ACCOUNT":
              packageReason = "No active packages on account";
              break;
            default: {
              // Check if member has active packages of a different category (e.g. Space / FT)
              const otherActive = member.packages
                .filter((p: any) => p.status === "ACTIVE" && p.remainingClasses > 0)
                .map((p: any) => p.name);
              if (otherActive.length > 0) {
                packageReason = `Holds other packages (${otherActive.join(", ")}), but none cover ${category}`;
              } else {
                packageReason = `No active package covering ${className} (${category})`;
              }
              break;
            }
          }
        }
      }

      auditRows.push({
        sessionDate: dateFormatted,
        className,
        category,
        coaches: coachNames,
        branch,
        memberName,
        phone,
        bookingMethod,
        scanStatus,
        paymentStatus,
        paidAmount,
        hasCoveringPackage,
        packageReason,
      });
    }
  }

  // Print results
  console.log(`\n========================================================================================`);
  console.log(`AUDIT RESULTS: ${auditRows.length} Walk-in / Waitlist Fallback Incidents Found`);
  console.log(`========================================================================================\n`);

  if (auditRows.length === 0) {
    console.log("No incidents found matching Walk-In / Waitlist Confirmed without packages.");
    await mongoose.disconnect();
    return;
  }

  // Group summary
  const couldBeCoveredCount = auditRows.filter((r) => r.hasCoveringPackage.startsWith("YES")).length;
  const shouldHavePaidCount = auditRows.filter((r) => r.hasCoveringPackage.startsWith("NO")).length;
  const noPaymentCount = auditRows.filter((r) => r.paymentStatus === "NO PAYMENT RECORDED").length;

  console.log(`Summary Statistics:`);
  console.log(`  - Total incidents: ${auditRows.length}`);
  console.log(`  - Members who HAD an active package that could have covered it: ${couldBeCoveredCount}`);
  console.log(`  - Members who had NO package and SHOULD HAVE PAID a walk-in:    ${shouldHavePaidCount}`);
  console.log(`  - Incidents with NO payment record in DB:                      ${noPaymentCount}\n`);

  console.table(
    auditRows.map((r) => ({
      Date: r.sessionDate,
      Class: r.className,
      Category: r.category,
      Coach: r.coaches,
      Member: r.memberName,
      Phone: r.phone,
      Scan: r.scanStatus,
      Payment: r.paymentStatus,
      "Covered by Package?": r.hasCoveringPackage,
      "Package Diagnosis": r.packageReason,
    })),
  );

  // Write to CSV
  const csvFileName =
    process.argv.find((a) => a.startsWith("--csv="))?.split("=")[1] ||
    `unpaid-waitlist-walkins-audit-${formatInTimeZone(new Date(), CAIRO_TZ, "yyyy-MM-dd-HHmm")}.csv`;

  const csvHeader = [
    "Date",
    "Class",
    "Category",
    "Coach",
    "Branch",
    "Member Name",
    "Phone",
    "Booking Method",
    "Scan Status",
    "Payment Status",
    "Paid Amount (EGP)",
    "Had Covering Package?",
    "Package Diagnosis",
  ];

  const csvRows = auditRows.map((r) => [
    `"${r.sessionDate}"`,
    `"${r.className}"`,
    `"${r.category}"`,
    `"${r.coaches}"`,
    `"${r.branch}"`,
    `"${r.memberName}"`,
    `"${r.phone}"`,
    `"${r.bookingMethod}"`,
    `"${r.scanStatus}"`,
    `"${r.paymentStatus}"`,
    `"${r.paidAmount}"`,
    `"${r.hasCoveringPackage}"`,
    `"${r.packageReason.replace(/"/g, '""')}"`,
  ]);

  const csvContent = "\uFEFF" + [csvHeader.join(","), ...csvRows.map((r) => r.join(","))].join("\r\n");
  fs.writeFileSync(csvFileName, csvContent, "utf8");
  console.log(`\n[Audit] Detailed CSV exported to: ${path.resolve(csvFileName)}`);

  await mongoose.disconnect();
  console.log("[Audit] Database disconnected. Done.");
}

runAudit().catch((err) => {
  console.error("[Audit Fatal Error]", err);
  process.exit(1);
});
