// Audit script: checks Class, ScheduledClass, Schedule collections on TMS_PROD
// Run: node scripts/audit-classes.js
// Read-only — no writes performed.

const { MongoClient, ObjectId } = require("../node_modules/mongoose/node_modules/mongodb");

const MONGO_URI =
  "mongodb://yasserziad59_db_user:UHSM9oTJOnPT1r2x@ac-ynhcti6-shard-00-00.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-01.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-02.nenjvkr.mongodb.net:27017/TMS_PROD?ssl=true&replicaSet=atlas-vmtjfi-shard-0&authSource=admin&appName=Cluster0";

const issues = [];

function issue(collection, id, type, detail) {
  issues.push({ collection, id: id?.toString(), type, detail });
}

function section(title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function auditClasses(db, locationIds) {
  section("CLASSES — locations audit");
  const classes = await db.collection("classes").find({}).toArray();
  console.log(`Total classes: ${classes.length}`);
  console.log(`Known locations: ${locationIds.size}\n`);

  const classIds = new Set(classes.map((c) => c._id.toString()));

  for (const cls of classes) {
    const id = cls._id;
    const label = `"${cls.title || "(no title)"}"`;

    // locations missing entirely
    if (cls.locations == null) {
      issue("classes", id, "LOCATIONS_MISSING", `${label} locations field is null/undefined`);
      continue;
    }

    // locations not an array (schema defines [ObjectId])
    if (!Array.isArray(cls.locations)) {
      issue("classes", id, "LOCATIONS_NOT_ARRAY", `${label} locations=${JSON.stringify(cls.locations)} (type=${typeof cls.locations})`);
      continue;
    }

    // empty array — class has no location assigned
    if (cls.locations.length === 0) {
      issue("classes", id, "LOCATIONS_EMPTY", `${label} locations array is empty`);
      continue;
    }

    for (let i = 0; i < cls.locations.length; i++) {
      const loc = cls.locations[i];

      // null/undefined entry inside array
      if (loc == null) {
        issue("classes", id, "LOCATIONS_NULL_ENTRY", `${label} locations[${i}] is null/undefined`);
        continue;
      }

      // not a valid ObjectId (should be 24-char hex string or ObjectId instance)
      const locStr = loc.toString();
      const isValidObjectId = /^[a-f\d]{24}$/i.test(locStr);
      if (!isValidObjectId) {
        issue("classes", id, "LOCATIONS_INVALID_OBJECTID", `${label} locations[${i}]=${JSON.stringify(locStr)}`);
        continue;
      }

      // valid ObjectId but no matching document in locations collection
      if (!locationIds.has(locStr)) {
        issue("classes", id, "LOCATIONS_ORPHANED_REF", `${label} locations[${i}]=${locStr} not found in locations collection`);
      }
    }

    // duplicate location IDs within same class
    const seen = new Set();
    for (const loc of cls.locations) {
      const s = loc?.toString();
      if (s && seen.has(s)) {
        issue("classes", id, "LOCATIONS_DUPLICATE", `${label} location ${s} appears more than once`);
      }
      if (s) seen.add(s);
    }
  }

  return classIds;
}

async function auditScheduledClasses(db, classIds, coachIds, userIds) {
  section("SCHEDULED CLASSES");
  const sclasses = await db.collection("scheduledclasses").find({}).toArray();
  console.log(`Total: ${sclasses.length}`);

  const scIds = new Set(sclasses.map((s) => s._id.toString()));

  for (const sc of sclasses) {
    const id = sc._id;

    // Required fields
    if (!sc.cid) {
      issue("scheduledclasses", id, "MISSING_CID", "cid is null/missing");
    } else if (!classIds.has(sc.cid.toString())) {
      issue("scheduledclasses", id, "ORPHANED_CID", `cid=${sc.cid} not in classes`);
    }

    if (!sc.startTime) {
      issue("scheduledclasses", id, "MISSING_START_TIME", "startTime is null");
    } else if (!(sc.startTime instanceof Date) || isNaN(sc.startTime.getTime())) {
      issue("scheduledclasses", id, "INVALID_START_TIME", `startTime=${sc.startTime}`);
    }

    if (!sc.endTime) {
      issue("scheduledclasses", id, "MISSING_END_TIME", "endTime is null");
    } else if (!(sc.endTime instanceof Date) || isNaN(sc.endTime.getTime())) {
      issue("scheduledclasses", id, "INVALID_END_TIME", `endTime=${sc.endTime}`);
    }

    if (sc.startTime && sc.endTime && sc.startTime instanceof Date && sc.endTime instanceof Date) {
      if (sc.startTime >= sc.endTime) {
        issue("scheduledclasses", id, "START_AFTER_END", `start=${sc.startTime.toISOString()} end=${sc.endTime.toISOString()}`);
      }
    }

    if (sc.availableSlots == null || isNaN(sc.availableSlots)) {
      issue("scheduledclasses", id, "MISSING_AVAILABLE_SLOTS", `availableSlots=${sc.availableSlots}`);
    } else if (sc.availableSlots < 0) {
      issue("scheduledclasses", id, "NEGATIVE_AVAILABLE_SLOTS", `availableSlots=${sc.availableSlots}`);
    }

    if (sc.coachId && !coachIds.has(sc.coachId.toString())) {
      issue("scheduledclasses", id, "ORPHANED_COACH_ID", `coachId=${sc.coachId} not in coaches`);
    }

    // bookedMembers integrity
    if (Array.isArray(sc.bookedMembers)) {
      const seenUids = new Set();
      for (const booking of sc.bookedMembers) {
        if (!booking.uid) {
          issue("scheduledclasses", id, "BOOKING_MISSING_UID", `booking=${JSON.stringify(booking)}`);
          continue;
        }
        const uidStr = booking.uid.toString();
        if (seenUids.has(uidStr)) {
          issue("scheduledclasses", id, "DUPLICATE_BOOKED_MEMBER", `uid=${uidStr}`);
        }
        seenUids.add(uidStr);

        if (!booking.method || booking.method.trim() === "") {
          issue("scheduledclasses", id, "BOOKING_MISSING_METHOD", `uid=${uidStr}`);
        }
        if (!userIds.has(uidStr)) {
          issue("scheduledclasses", id, "BOOKING_ORPHANED_USER", `uid=${uidStr} not in users`);
        }
      }

      // scans integrity
      if (Array.isArray(sc.scans)) {
        const seenScanUids = new Set();
        for (const scan of sc.scans) {
          if (!scan.uid) {
            issue("scheduledclasses", id, "SCAN_MISSING_UID", `scan=${JSON.stringify(scan)}`);
            continue;
          }
          const scanUid = scan.uid.toString();

          // Duplicate scan check (same uid + same status)
          const scanKey = `${scanUid}:${scan.status}`;
          if (seenScanUids.has(scanKey)) {
            issue("scheduledclasses", id, "DUPLICATE_SCAN", `uid=${scanUid} status=${scan.status}`);
          }
          seenScanUids.add(scanKey);

          if (!scan.scanTime || !(scan.scanTime instanceof Date) || isNaN(scan.scanTime.getTime())) {
            issue("scheduledclasses", id, "SCAN_MISSING_TIME", `uid=${scanUid} scanTime=${scan.scanTime}`);
          }

          // Scan exists for user not in bookedMembers
          if (!seenUids.has(scanUid)) {
            issue("scheduledclasses", id, "SCAN_USER_NOT_BOOKED", `uid=${scanUid} scanned but not in bookedMembers`);
          }
        }
      }
    }
  }

  return scIds;
}

async function auditSchedules(db, scIds) {
  section("SCHEDULES");
  const schedules = await db.collection("schedules").find({}).toArray();
  console.log(`Total: ${schedules.length}`);

  for (const sched of schedules) {
    const id = sched._id;

    if (!sched.date) {
      issue("schedules", id, "MISSING_DATE", "date is null/missing");
    } else if (!(sched.date instanceof Date) || isNaN(sched.date.getTime())) {
      issue("schedules", id, "INVALID_DATE", `date=${sched.date}`);
    }

    if (!Array.isArray(sched.classes)) {
      issue("schedules", id, "CLASSES_NOT_ARRAY", `type=${typeof sched.classes}`);
      continue;
    }

    const seenClassIds = new Set();
    for (const cid of sched.classes) {
      const cidStr = cid.toString();
      if (seenClassIds.has(cidStr)) {
        issue("schedules", id, "DUPLICATE_CLASS_IN_SCHEDULE", `scid=${cidStr}`);
      }
      seenClassIds.add(cidStr);

      if (!scIds.has(cidStr)) {
        issue("schedules", id, "ORPHANED_SCHEDULED_CLASS", `scid=${cidStr} not in scheduledclasses`);
      }
    }
  }
}

async function main() {
  console.log("Connecting to TMS_PROD...");
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db("TMS_PROD");
  console.log("Connected.");

  // Load reference IDs upfront for orphan checks
  console.log("\nLoading reference collections...");
  const coachDocs = await db.collection("coaches").find({}, { projection: { _id: 1 } }).toArray();
  const coachIds = new Set(coachDocs.map((c) => c._id.toString()));
  const userDocs = await db.collection("users").find({}, { projection: { _id: 1 } }).toArray();
  const userIds = new Set(userDocs.map((u) => u._id.toString()));
  const locationDocs = await db.collection("locations").find({}, { projection: { _id: 1, branchName: 1 } }).toArray();
  const locationIds = new Set(locationDocs.map((l) => l._id.toString()));
  console.log(`  coaches: ${coachIds.size}, users: ${userIds.size}, locations: ${locationIds.size}`);
  console.log("  Known locations:");
  for (const loc of locationDocs) console.log(`    ${loc._id}  "${loc.branchName}"`);

  const classIds = await auditClasses(db, locationIds);
  const scIds = await auditScheduledClasses(db, classIds, coachIds, userIds);
  await auditSchedules(db, scIds);

  await client.close();

  // Summary
  section("SUMMARY");
  if (issues.length === 0) {
    console.log("No issues found.");
  } else {
    console.log(`Total issues found: ${issues.length}\n`);

    // Group by type
    const byType = {};
    for (const issue of issues) {
      const key = `${issue.collection} / ${issue.type}`;
      byType[key] = byType[key] || [];
      byType[key].push(issue);
    }

    for (const [key, list] of Object.entries(byType).sort()) {
      console.log(`\n[${list.length}x] ${key}`);
      for (const item of list) {
        console.log(`  _id=${item.id}  ${item.detail}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
