#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} = require("firebase/auth");
const {
  getFirestore,
  doc,
  setDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  writeBatch,
  serverTimestamp,
  Timestamp,
} = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyCdTNTE8BvSmctSde7uMg839nQ4MWkQa-E",
  authDomain: "themindspace-3f4ef.firebaseapp.com",
  projectId: "themindspace-3f4ef",
  storageBucket: "themindspace-3f4ef.appspot.com",
  messagingSenderId: "981977623828",
  appId: "1:981977623828:web:232409ddff6ac1fd85e601",
};

const dataPath = path.join(__dirname, "firebase-firestore-data.json");
const seedData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const seedName = seedData.seedName || "firebase-firestore-seed";
const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;

function withTimeout(promise, milliseconds) {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${milliseconds / 1000} seconds`));
    }, milliseconds);
  });

  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * dayMs);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDayId(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromOffset(offsetDays) {
  return addDays(now, offsetDays);
}

function timestampFromOffset(offsetDays) {
  return Timestamp.fromDate(dateFromOffset(offsetDays));
}

function timestampFromDate(date) {
  return Timestamp.fromDate(date);
}

function scheduleStartDate(template, dayOffset) {
  const [hours, minutes] = template.startTime.split(":").map(Number);
  const date = addDays(now, dayOffset);
  date.setHours(hours, minutes, 0, 0);

  if (dayOffset === 0 && date.getTime() < now.getTime() + 45 * 60 * 1000) {
    return new Date(now.getTime() + (template.todayOffsetMinutes || 90) * 60 * 1000);
  }

  return date;
}

function classIdFor(template, dayOffset) {
  const dayId = formatDayId(addDays(now, dayOffset));
  return `${dayId}_${template.id}`;
}

function buildClassDoc(template, dayOffset) {
  const startDate = scheduleStartDate(template, dayOffset);
  const endDate = new Date(startDate.getTime() + template.durationMinutes * 60 * 1000);

  return {
    id: classIdFor(template, dayOffset),
    dayId: formatDayId(startDate),
    data: {
      title: template.title,
      type: template.type,
      coach: template.coach,
      price: template.price,
      totalSlots: template.totalSlots,
      availableSlots: template.availableSlots,
      requiresBooking: template.requiresBooking,
      startTime: timestampFromDate(startDate),
      endTime: timestampFromDate(endDate),
      seededBy: seedName,
      seededAt: serverTimestamp(),
    },
  };
}

async function signInOrCreateUser(auth, userData) {
  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      userData.email,
      userData.password
    );
    console.log(`Signed in Firebase user: ${credential.user.uid}`);
    return credential.user;
  } catch (error) {
    if (error.code !== "auth/user-not-found" && error.code !== "auth/invalid-credential") {
      throw error;
    }

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        userData.email,
        userData.password
      );
      console.log(`Created Firebase user: ${credential.user.uid}`);
      return credential.user;
    } catch (createError) {
      if (createError.code === "auth/email-already-in-use") {
        throw new Error(
          `Firebase user ${userData.email} exists, but password ${userData.password} did not work.`
        );
      }
      throw createError;
    }
  }
}

async function signInExistingUser(auth, userData) {
  const credential = await signInWithEmailAndPassword(
    auth,
    userData.email,
    userData.password
  );
  return credential.user;
}

function isPermissionDenied(error) {
  const message = String(error && error.message ? error.message : error);
  return message.includes("PERMISSION_DENIED") || message.includes("permission");
}

async function runWithProtectedWriter(auth, fn) {
  try {
    await fn();
    return;
  } catch (error) {
    if (!isPermissionDenied(error)) {
      throw error;
    }

    const candidateErrors = [];
    const candidates = seedData.protectedWriterCandidates || [];
    for (const candidate of candidates) {
      try {
        await signInExistingUser(auth, candidate);
        console.log(`Retrying protected write as ${candidate.email}...`);
        await fn();
        return;
      } catch (candidateError) {
        candidateErrors.push(`${candidate.email}: ${candidateError.message}`);
      }
    }

    throw new Error(`${error.message} Tried protected writers: ${candidateErrors.join(" | ")}`);
  }
}

async function commitBatch(db, operations) {
  for (let i = 0; i < operations.length; i += 450) {
    const batch = writeBatch(db);
    operations.slice(i, i + 450).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function deleteQuerySnapshot(db, snapshot) {
  const operations = snapshot.docs.map((snapshotDoc) => (batch) => {
    batch.delete(snapshotDoc.ref);
  });

  await commitBatch(db, operations);
}

async function findOrCreateMember(db, firebaseUser, userData) {
  const byPhone = query(
    collection(db, "Members"),
    where("Phone number", "==", userData.phone),
    limit(1)
  );
  const byPhoneSnapshot = await getDocs(byPhone);

  if (!byPhoneSnapshot.empty) {
    const memberRef = byPhoneSnapshot.docs[0].ref;
    await setDoc(
      memberRef,
      {
        Name: userData.name,
        "Phone number": userData.phone,
        email: userData.email,
        user_id: firebaseUser.uid,
        updatedAt: serverTimestamp(),
        seededBy: seedName,
      },
      { merge: true }
    );
    return memberRef;
  }

  const byUser = query(
    collection(db, "Members"),
    where("user_id", "==", firebaseUser.uid),
    limit(1)
  );
  const byUserSnapshot = await getDocs(byUser);

  if (!byUserSnapshot.empty) {
    const memberRef = byUserSnapshot.docs[0].ref;
    await setDoc(
      memberRef,
      {
        Name: userData.name,
        "Phone number": userData.phone,
        email: userData.email,
        user_id: firebaseUser.uid,
        updatedAt: serverTimestamp(),
        seededBy: seedName,
      },
      { merge: true }
    );
    return memberRef;
  }

  const memberRef = doc(collection(db, "Members"));
  await setDoc(memberRef, {
    Name: userData.name,
    "Phone number": userData.phone,
    email: userData.email,
    user_id: firebaseUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    seededBy: seedName,
  });
  return memberRef;
}

async function seedUserAndMember(db, auth) {
  const userData = seedData.testUser;
  const firebaseUser = await signInOrCreateUser(auth, userData);

  await setDoc(
    doc(db, "users", firebaseUser.uid),
    {
      email: userData.email,
      name: userData.name,
      phone_number: userData.phone,
      user_id: firebaseUser.uid,
      updatedAt: serverTimestamp(),
      seededBy: seedName,
    },
    { merge: true }
  );

  const memberRef = await findOrCreateMember(db, firebaseUser, userData);
  return { firebaseUser, memberRef };
}

async function seedCoaches(db) {
  const operations = seedData.coaches.map((coach) => (batch) => {
    batch.set(
      doc(db, "Coaches", coach.id),
      {
        ...coach,
        seededBy: seedName,
        seededAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  await commitBatch(db, operations);
}

async function seedPackageCatalog(db) {
  const operations = seedData.packageCatalog.map(({ id, ...packageData }) => (batch) => {
    batch.set(
      doc(db, "Packages", id),
      {
        ...packageData,
        seededBy: seedName,
        seededAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  await commitBatch(db, operations);
}

async function replaceMemberPackages(db, memberRef) {
  const packagesRef = collection(db, "Members", memberRef.id, "Packages");
  const existingPackages = await getDocs(packagesRef);

  for (const packageDoc of existingPackages.docs) {
    const attendanceSnapshot = await getDocs(collection(packageDoc.ref, "Attendance"));
    await deleteQuerySnapshot(db, attendanceSnapshot);
  }

  await deleteQuerySnapshot(db, existingPackages);

  const operations = seedData.memberPackages.map(({ id, attendance, startOffsetDays, endOffsetDays, ...packageData }) => (batch) => {
    batch.set(doc(packagesRef, id), {
      ...packageData,
      packageStartDate: timestampFromOffset(startOffsetDays),
      PackageEndDate: timestampFromOffset(endOffsetDays),
      updated: true,
      seededBy: seedName,
      seededAt: serverTimestamp(),
    });
  });

  await commitBatch(db, operations);

  const attendanceOperations = [];
  seedData.memberPackages.forEach(({ id, attendance }) => {
    const packageRef = doc(packagesRef, id);

    attendanceOperations.push((batch) => {
      batch.set(
        doc(collection(packageRef, "Attendance"), "metadata"),
        {
          firstAttendanceDate: timestampFromOffset(-3),
          lastAttendanceDate: serverTimestamp(),
          totalAttendances: attendance.length,
          seededBy: seedName,
        },
        { merge: true }
      );
    });

    attendance.forEach((record) => {
      attendanceOperations.push((batch) => {
        batch.set(doc(collection(packageRef, "Attendance"), record.id), {
          classType: record.classType,
          attendanceDate: timestampFromOffset(record.offsetDays),
          classDeducted: record.classDeducted,
          seededBy: seedName,
        });
      });
    });
  });

  await commitBatch(db, attendanceOperations);
}

async function clearSeededScheduleDays(db) {
  const days = new Set();
  seedData.scheduleTemplates.forEach((template) => {
    template.dayOffsets.forEach((dayOffset) => {
      days.add(formatDayId(addDays(now, dayOffset)));
    });
  });

  for (const dayId of days) {
    const seededClassesQuery = query(
      collection(db, "Schedule", dayId, "classes"),
      where("seededBy", "==", seedName)
    );
    const snapshot = await getDocs(seededClassesQuery);
    await deleteQuerySnapshot(db, snapshot);
  }
}

async function seedSchedule(db) {
  await clearSeededScheduleDays(db);

  const operations = [];
  seedData.scheduleTemplates.forEach((template) => {
    template.dayOffsets.forEach((dayOffset) => {
      const classDoc = buildClassDoc(template, dayOffset);
      operations.push((batch) => {
        batch.set(doc(db, "Schedule", classDoc.dayId), {
          date: classDoc.dayId,
          seededBy: seedName,
          seededAt: serverTimestamp(),
        }, { merge: true });
        batch.set(
          doc(db, "Schedule", classDoc.dayId, "classes", classDoc.id),
          classDoc.data,
          { merge: true }
        );
      });
    });
  });

  await commitBatch(db, operations);
}

async function clearSeededBookingScheduleFallback(db) {
  const seededClassesQuery = query(
    collection(db, "Bookings"),
    where("seededClass", "==", true)
  );
  const snapshot = await getDocs(seededClassesQuery);
  await deleteQuerySnapshot(db, snapshot);
}

async function seedBookingScheduleFallback(db) {
  await clearSeededBookingScheduleFallback(db);

  const operations = [];
  seedData.scheduleTemplates.forEach((template) => {
    template.dayOffsets.forEach((dayOffset) => {
      const classDoc = buildClassDoc(template, dayOffset);
      operations.push((batch) => {
        batch.set(
          doc(db, "Bookings", classDoc.id),
          {
            ...classDoc.data,
            className: classDoc.data.title,
            bookedUsers: {},
            seededClass: true,
            seededDayId: classDoc.dayId,
            source: "bookings-schedule-fallback",
          },
          { merge: true }
        );
      });
    });
  });

  await commitBatch(db, operations);
}

async function clearSeededBookings(db, uid) {
  const userBookingsQuery = query(
    collection(db, "users", uid, "Bookings"),
    where("seededBy", "==", seedName)
  );
  await deleteQuerySnapshot(db, await getDocs(userBookingsQuery));
}

function getTemplateById(templateId) {
  const template = seedData.scheduleTemplates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown schedule template ${templateId}`);
  return template;
}

async function seedBookings(db, firebaseUser) {
  await clearSeededBookings(db, firebaseUser.uid);

  const userData = seedData.testUser;
  const operations = [];

  seedData.sampleBookings.forEach((booking) => {
    const template = getTemplateById(booking.templateId);
    const classDoc = buildClassDoc(template, booking.dayOffset);
    const bookingData = {
      classId: classDoc.id,
      className: classDoc.data.title,
      isPaid: booking.isPaid,
      coach: classDoc.data.coach,
      startTime: classDoc.data.startTime,
      endTime: classDoc.data.endTime,
      requiresBooking: classDoc.data.requiresBooking,
      bookingTime: timestampFromOffset(-1),
      seededBy: seedName,
    };

    if (booking.price) bookingData.price = booking.price;
    if (booking.qrCodeHash) bookingData.qrCodeHash = booking.qrCodeHash;
    if (typeof booking.isValid === "boolean") bookingData.isValid = booking.isValid;

    operations.push((batch) => {
      batch.set(
        doc(db, "users", firebaseUser.uid, "Bookings", booking.id),
        bookingData,
        { merge: true }
      );
      batch.set(
        doc(db, "Bookings", classDoc.id),
        {
          className: classDoc.data.title,
          seededBy: seedName,
          bookedUsers: {
            [firebaseUser.uid]: {
              name: userData.name,
              phone: userData.phone,
              bookingTime: timestampFromOffset(-1),
            },
          },
        },
        { merge: true }
      );
    });
  });

  await commitBatch(db, operations);
}

async function seedPayments(db, firebaseUser) {
  const operations = seedData.samplePayments.map((payment) => (batch) => {
    batch.set(
      doc(db, "Paymob", payment.id),
      {
        ...payment,
        Id: firebaseUser.uid,
        Name: seedData.testUser.name,
        Phone: seedData.testUser.phone,
        timestamp: serverTimestamp(),
        seededBy: seedName,
      },
      { merge: true }
    );
  });

  await commitBatch(db, operations);
}

async function seedScans(db, memberRef) {
  const operations = seedData.sampleScans.map((scan) => {
    const dayId = formatDayId(addDays(now, scan.dayOffset));
    return (batch) => {
      batch.set(
        doc(db, "Scans", dayId, "tries", scan.id),
        {
          packageId: "1",
          packageName: "Functional training",
          userName: seedData.testUser.name,
          userPhone: seedData.testUser.phone,
          memberId: memberRef.id,
          success: scan.success,
          scanMessage: scan.scanMessage,
          scanTime: serverTimestamp(),
          seededBy: seedName,
        },
        { merge: true }
      );
    };
  });

  await commitBatch(db, operations);
}

async function main() {
  console.log(`Seeding Flutter Firestore data from ${path.basename(dataPath)}...`);

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const { firebaseUser, memberRef } = await seedUserAndMember(db, auth);
  const failures = [];

  async function runSection(name, required, fn) {
    try {
      await fn();
      console.log(`Seeded ${name}.`);
    } catch (error) {
      const message = `${name}: ${error.message}`;
      failures.push({ name, required, message });
      console.warn(`Skipped ${message}`);
    }
  }

  await runSection("coaches", false, () => runWithProtectedWriter(auth, () => seedCoaches(db)));
  await runSection("package catalog", false, () => seedPackageCatalog(db));
  await runSection("schedule classes", false, () => runWithProtectedWriter(auth, () => seedSchedule(db)));

  await signInOrCreateUser(auth, seedData.testUser);
  await runSection("bookings schedule fallback", true, () => seedBookingScheduleFallback(db));
  await runSection("member packages", true, () => replaceMemberPackages(db, memberRef));
  await runSection("sample bookings", false, () => seedBookings(db, firebaseUser));
  await runSection("sample payments", false, () => seedPayments(db, firebaseUser));
  await runSection("sample scans", false, () => seedScans(db, memberRef));

  const scheduledCount = seedData.scheduleTemplates.reduce(
    (total, template) => total + template.dayOffsets.length,
    0
  );

  console.log("");
  console.log(`Seeded Firestore test data for ${seedData.testUser.email}.`);
  console.log(`Member document: Members/${memberRef.id}`);
  console.log(`Packages: ${seedData.memberPackages.length} member packages, ${seedData.packageCatalog.length} catalog packages`);
  console.log(`Classes: ${scheduledCount} upcoming classes available through the app fallback`);
  console.log(`Bookings: ${seedData.sampleBookings.length} sample bookings`);
  console.log("Open Classes and book any Functional training, Studio, or Personal Training class to use the seeded packages.");

  const requiredFailures = failures.filter((failure) => failure.required);
  if (requiredFailures.length > 0) {
    throw new Error(
      `Required seed sections failed: ${requiredFailures
        .map((failure) => failure.message)
        .join("; ")}`
    );
  }

  if (failures.length > 0) {
    console.log("");
    console.log("Some optional protected collections were skipped:");
    failures.forEach((failure) => console.log(`- ${failure.message}`));
  }
}

withTimeout(main(), 45000)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Firebase Firestore seed failed:", error.message);
    process.exit(1);
  });
