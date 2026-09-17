import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/user";
import Location from "../models/location";
import Coach from "../models/coach";
import Class from "../models/class";
import Package from "../models/package";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import Payment from "../models/payment";
import Refund from "../models/refund";
import DeductionLog from "../models/deductionLog";
import NonUserBooking from "../models/nonUserBookings";
import ReceivedEmail from "../models/receivedEmail";

dotenv.config();

/**
 * Fills a LOCAL demo database with realistic finance data so the accountant
 * dashboards can be tried end to end. Refuses to run unless the database name
 * contains "demo", and wipes only that demo database.
 *
 * Usage:
 *   MONGO_URI=mongodb://127.0.0.1:27017/tms_finance_demo npx ts-node src/scripts/seed-finance-demo.ts
 *
 * Logins created (password for all: Password123!):
 *   01000000077  accountant
 *   01000000078  management
 */

const DAY = 24 * 60 * 60 * 1000;
let seed = 42;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
const oid = () => new Types.ObjectId();

async function main() {
  const uri = process.env.MONGO_URI || "";
  const dbName = uri.split("/").pop()?.split("?")[0] ?? "";
  if (!/demo/i.test(dbName) || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error(`Refusing to seed "${dbName}". Use a local database whose name contains "demo".`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  console.log(`Seeding ${dbName}...`);

  const now = new Date();
  const password = await bcrypt.hash("Password123!", 12);

  const [zamalek, newCairo] = await Location.insertMany([
    { branchName: "Zamalek", location: "Zamalek, Cairo", locationUrl: "https://maps.example.com/zamalek" },
    { branchName: "New Cairo", location: "New Cairo", locationUrl: "https://maps.example.com/newcairo" },
  ]);
  const branches = [zamalek._id, newCairo._id];

  const staff = await User.insertMany([
    { name: "Finance Team", email: "finance@example.com", phoneNumber: "01000000077", password, role: "accountant", tmsEmail: "finance@the-mind-space.com" },
    { name: "Management", email: "manager@example.com", phoneNumber: "01000000078", password, role: "management" },
    { name: "Front Desk Zamalek", email: "desk.z@example.com", phoneNumber: "01000000079", password, role: "branch_admin", locationId: zamalek._id },
  ]);
  const deskUser = staff[2]._id;

  const coachNames = ["Hana Abaza", "Omar Adel", "Nour Samir", "Karim Fathy"];
  const coaches = await Coach.insertMany(
    coachNames.map((coachName, i) => ({ coachName, phoneNumber: `0101000000${i}` })),
  );
  const [hana, omar, nour, karim] = coaches;

  const classes = await Class.insertMany([
    { title: "Mat Pilates", category: "STUDIO", price: 350, locations: branches },
    { title: "Reformer", category: "STUDIO", price: 450, locations: branches },
    { title: "HIIT", category: "FUNCTIONAL_TRAINING", price: 300, locations: branches },
    { title: "Strength Lab", category: "FUNCTIONAL_TRAINING", price: 320, locations: branches },
    { title: "Prenatal Yoga", category: "PRE_POST_NATAL", price: 400, locations: [zamalek._id] },
  ]);

  const packages = await Package.insertMany([
    { name: "Studio 8", category: "STUDIO", price: 2400, numberOfSessions: 8, expiryPeriod: 30, opensClasses: [classes[0]._id, classes[1]._id] },
    { name: "Studio 12", category: "STUDIO", price: 3300, numberOfSessions: 12, expiryPeriod: 45, opensClasses: [classes[0]._id, classes[1]._id] },
    { name: "Functional 12", category: "FUNCTIONAL_TRAINING", price: 2800, numberOfSessions: 12, expiryPeriod: 30, opensClasses: [classes[2]._id, classes[3]._id] },
    { name: "Mixed 10", category: "MIXED", price: 3000, numberOfSessions: 10, expiryPeriod: 30, opensClasses: classes.map((c) => c._id) },
    { name: "Mama Moves 6", category: "PRE_POST_NATAL", price: 2100, numberOfSessions: 6, expiryPeriod: 30, locationId: zamalek._id, opensClasses: [classes[4]._id] },
    { name: "PT 10 - Hana", category: "PERSONAL_TRAINING", price: 6000, numberOfSessions: 10, expiryPeriod: 60, coachId: String(hana._id), opensClasses: [] },
    { name: "PT 5 - Omar", category: "PERSONAL_TRAINING", price: 3200, numberOfSessions: 5, expiryPeriod: 30, coachId: String(omar._id), opensClasses: [] },
    { name: "Open Gym Monthly", category: "OPEN_GYM", price: 1500, numberOfSessions: 10000, expiryPeriod: 30, opensClasses: [] },
    { name: "Space Membership", category: "SPACE_MEMBERSHIP", price: 2500, numberOfSessions: 10000, expiryPeriod: 30, opensClasses: [] },
  ]);
  const classPackages = packages.slice(0, 5);
  const ptPackages = packages.slice(5, 7);
  const firstNames = ["Salma", "Youssef", "Mariam", "Ahmed", "Laila", "Mostafa", "Farida", "Ali", "Nadine", "Hassan", "Jana", "Tarek", "Malak", "Ziad", "Habiba", "Omar", "Nour", "Karim", "Sara", "Adam", "Dina", "Seif", "Rana", "Hady", "Yasmin", "Khaled", "Lina", "Amr", "Mona", "Fady"];
  const lastNames = ["Hassan", "Mansour", "Fahmy", "Saleh", "Gamal", "Nabil", "Aziz", "Farouk", "Shawky", "Zaki"];

  const memberUsers = await User.insertMany(
    firstNames.map((first, i) => ({
      name: `${first} ${pick(lastNames)}`,
      email: `member${i}@example.com`,
      phoneNumber: `0120000${String(i).padStart(4, "0")}`,
      password,
      role: "member",
      createdAt: new Date(now.getTime() - (20 + Math.floor(rand() * 200)) * DAY),
    })),
  );

  const payments: any[] = [];
  const refunds: any[] = [];
  const memberDocs: any[] = [];
  const deductionLogs: any[] = [];
  const methods = ["CASH", "CASH", "VISA", "INSTAPAY", "APP", "APP", "PAYMENT_LINK", "VALU"];

  const addPayment = (p: any) => {
    const doc = { _id: oid(), isRefunded: false, ...p };
    if (["APP", "PAYMENT_LINK"].includes(doc.paymentMethod) && !doc.merchantReferenceId && chance(0.93)) {
      doc.merchantReferenceId = `GD-${Math.floor(rand() * 1e9)}`;
    }
    payments.push(doc);
    return doc;
  };

  // Members, their package history and PT usage.
  for (const [i, user] of memberUsers.entries()) {
    const home = i % 3 === 0 ? newCairo._id : zamalek._id;
    const memberPackages: any[] = [];
    const ptAttendance: any[] = [];
    const isPt = i < 8;
    const pool = isPt ? ptPackages : classPackages;
    let cursor = new Date(now.getTime() - (100 + Math.floor(rand() * 60)) * DAY);

    while (cursor < now) {
      const pkg = i % 7 === 6 ? pick([packages[7], packages[8]]) : pick(pool);
      const start = new Date(cursor);
      const end = new Date(start.getTime() + pkg.expiryPeriod * DAY);
      const limited = pkg.numberOfSessions < 1000;
      const total = limited ? pkg.numberOfSessions : 0;
      const usedTarget = limited ? Math.min(total, Math.floor(total * (0.5 + rand() * 0.6))) : 0;
      const adjustments: any[] = [];
      let used = 0;
      for (let s = 0; s < usedTarget; s++) {
        const at = new Date(start.getTime() + ((s + 1) / (usedTarget + 1)) * (end.getTime() - start.getTime()));
        if (at > now) break;
        used += 1;
        adjustments.push({ date: at, attendanceDate: at, amount: 1, type: "DEDUCT", source: isPt ? "PT_ATTENDANCE" : "BOOKING", reason: "Session used" });
        if (isPt) {
          const coachId = String(pkg.coachId) === String(hana._id) ? hana._id : omar._id;
          if (chance(0.5)) ptAttendance.push({ pkgId: pkg._id, attendanceTime: at, date: at.toISOString().slice(0, 10) });
          else deductionLogs.push({ coachId, memberId: user._id, pkgId: pkg._id, memberPackageStartDate: start, reason: "PT session completed", sessionDate: at, classesRemainingAfter: total - used });
        }
      }
      const isFrozen = end > now && chance(0.12);
      const status = end <= now ? (limited && used >= total ? "COMPLETED" : "EXPIRED") : isFrozen ? "FROZEN" : "ACTIVE";
      memberPackages.push({
        _id: oid(),
        pkgId: pkg._id,
        name: pkg.name,
        pkgStartDate: start,
        pkgEndDate: end,
        status,
        remainingClasses: limited ? total - used : 10000,
        adjustmentHistory: adjustments,
        locationId: pkg.locationId ?? home,
        freezeInfo: {
          isFrozen,
          allowedFreezeDays: 7,
          usedFreezeDays: isFrozen ? 5 : 0,
          extraFreezeDaysApproved: 0,
          freezeHistory: isFrozen ? [{ startDate: new Date(now.getTime() - 3 * DAY), durationDays: 5, type: "STANDARD", reason: "Travel" }] : [],
        },
      });

      const discounted = chance(0.2);
      addPayment({
        uid: user._id,
        amount: discounted ? Math.round(pkg.price * 0.85) : pkg.price,
        paymentMethod: pick(methods),
        paymentTime: new Date(start.getTime() - Math.floor(rand() * 3) * 60 * 60 * 1000),
        purpose: "PACKAGE",
        pkgId: pkg._id,
        locationId: pkg.locationId ?? home,
      });

      // Some members churn after a package, others renew within days.
      if (chance(0.25)) break;
      cursor = new Date(end.getTime() + Math.floor(rand() * 10) * DAY);
    }

    memberDocs.push({ uid: user._id, packages: memberPackages, bookings: [], attendance: [], ptAttendance, isActive: true });
  }

  // Scheduled classes over the last 100 days plus the next week.
  const coachRota = [
    [hana._id],
    [nour._id],
    [karim._id],
    [hana._id, nour._id],
    [omar._id],
  ];
  const scheduled: any[] = [];
  const nonUserBookings: any[] = [];
  for (let d = -100; d <= 7; d++) {
    const day = new Date(now.getTime() + d * DAY);
    for (const [slot, hour] of [7, 10, 18, 20].entries()) {
      if (chance(0.25)) continue;
      const cls = classes[(slot + Math.abs(d)) % classes.length];
      const location = cls.title === "Prenatal Yoga" ? zamalek._id : pick(branches);
      const start = new Date(day);
      start.setUTCHours(hour - 3, 0, 0, 0);
      const duration = cls.title === "Reformer" ? 50 : cls.title === "Strength Lab" ? 75 : 60;
      const end = new Date(start.getTime() + duration * 60 * 1000);
      const capacity = cls.title === "Reformer" ? 8 : 14;
      const booked = new Map<string, string>();
      const scid = oid();
      const eligible = memberDocs.filter((m) =>
        m.packages.some((p: any) => p.pkgStartDate <= start && p.pkgEndDate >= start && classPackages.some((cp) => String(cp._id) === String(p.pkgId))),
      );
      const count = Math.min(capacity - 2, Math.floor(rand() * capacity));
      for (let b = 0; b < count; b++) {
        const member = pick(eligible.length ? eligible : memberDocs);
        const uid = String(member.uid);
        if (booked.has(uid)) continue;
        const active = member.packages.find((p: any) => p.pkgStartDate <= start && p.pkgEndDate >= start && classPackages.some((cp) => String(cp._id) === String(p.pkgId)));
        if (active && chance(0.85)) {
          booked.set(uid, active.name);
        } else {
          booked.set(uid, "Drop In");
          const pay = addPayment({
            uid: member.uid,
            amount: cls.price,
            paymentMethod: chance(0.1) ? "DEDUCTED" : pick(methods),
            paymentTime: new Date(start.getTime() - 2 * 60 * 60 * 1000),
            purpose: "DROPIN",
            scid,
            locationId: location,
          });
          member.bookings.push({ scid, bookingTime: pay.paymentTime, isDropIn: true, paymentId: pay._id });
        }
      }
      const past = end < now;
      const bookedMembers = [...booked.entries()].map(([uid, method]) => ({ uid: new Types.ObjectId(uid), method }));
      const scans = past
        ? bookedMembers.filter(() => chance(0.82)).map((b) => ({ uid: b.uid, scanTime: start, method: b.method, status: true }))
        : [];
      for (let n = 0; n < (chance(0.3) ? 2 : 0); n++) {
        const paid = past && chance(0.8);
        const nb = { _id: oid(), scid, name: `Guest ${Math.floor(rand() * 900 + 100)}`, phoneNumber: `0155${Math.floor(rand() * 1e7)}`, bookingTime: new Date(start.getTime() - DAY), status: paid ? "PAID" : past ? "ATTENDED" : "BOOKED" } as any;
        if (paid) {
          const pay = addPayment({ nonMemberName: nb.name, nonMemberPhone: nb.phoneNumber, amount: cls.price, paymentMethod: pick(methods), paymentTime: start, purpose: "NON_USER_BOOKING", scid, locationId: location });
          nb.paymentId = pay._id;
        }
        nonUserBookings.push(nb);
      }
      scheduled.push({
        _id: scid,
        cid: cls._id,
        locationId: location,
        startTime: start,
        endTime: end,
        availableSlots: Math.max(0, capacity - bookedMembers.length),
        bookedMembers,
        coachId: coachRota[(slot + Math.abs(d)) % coachRota.length],
        scans,
        waitlistedMembers: [],
        waitingList: [],
      });
    }
  }

  // Walk-ins, open gym day passes and misc payments.
  for (let d = -110; d <= 0; d++) {
    const day = new Date(now.getTime() + d * DAY);
    if (d === 0 && day > now) continue;
    for (let w = 0; w < Math.floor(rand() * 3); w++) {
      addPayment({ nonMemberName: `Walk-in ${Math.floor(rand() * 900 + 100)}`, nonMemberPhone: `0111${Math.floor(rand() * 1e7)}`, amount: pick([150, 200, 250]), paymentMethod: pick(["CASH", "CASH", "INSTAPAY"]), paymentTime: new Date(day.getTime() - Math.floor(rand() * 8) * 60 * 60 * 1000), purpose: "WALKIN", locationId: pick(branches) });
    }
    if (chance(0.15)) {
      addPayment({ nonMemberName: "Locker rental", amount: 100, paymentMethod: "CASH", paymentTime: day, purpose: "OTHER", note: "Locker rental", locationId: pick(branches) });
    }
  }

  // Anomalies for the ledger: a duplicate charge, an unusual amount, a missing reference.
  const dupSource = payments.find((p) => p.purpose === "PACKAGE" && p.paymentTime > new Date(now.getTime() - 20 * DAY));
  if (dupSource) addPayment({ ...dupSource, _id: oid(), paymentTime: new Date(dupSource.paymentTime.getTime() + 4 * 60 * 1000) });
  addPayment({ uid: memberUsers[3]._id, amount: 45000, paymentMethod: "VISA", paymentTime: new Date(now.getTime() - 6 * DAY), purpose: "PACKAGE", pkgId: packages[1]._id, locationId: zamalek._id, note: "Corporate bundle" });
  addPayment({ uid: memberUsers[4]._id, amount: 3300, paymentMethod: "APP", paymentTime: new Date(now.getTime() - 2 * DAY), purpose: "PACKAGE", pkgId: packages[1]._id, locationId: newCairo._id, merchantReferenceId: undefined, orderId: undefined });
  payments[payments.length - 1].merchantReferenceId = undefined;

  // Refunds and cash outs.
  const refundable = payments.filter((p) => p.paymentMethod !== "DEDUCTED" && p.purpose !== "OTHER");
  for (let r = 0; r < 14; r++) {
    const p = pick(refundable);
    if (p.isRefunded) continue;
    p.isRefunded = true;
    p.refundReason = pick(["Medical reason", "Class cancelled", "Moved abroad", "Duplicate charge"]);
    refunds.push({ type: "REFUND", reason: p.refundReason, amount: chance(0.3) ? Math.round(p.amount / 2) : p.amount, memberName: p.nonMemberName ?? null, memberId: p.uid ?? null, paymentId: p._id, recordedBy: deskUser, locationId: p.locationId, createdAt: new Date(Math.min(now.getTime(), p.paymentTime.getTime() + (1 + Math.floor(rand() * 5)) * DAY)) });
  }
  const unmarked = refundable.find((p) => !p.isRefunded && p.paymentTime > new Date(now.getTime() - 25 * DAY));
  if (unmarked) unmarked.isRefunded = true; // refunded flag without a refund record
  for (let c = 0; c < 18; c++) {
    refunds.push({ type: "CASHOUT", reason: pick(["Cleaning supplies", "Water delivery", "Maintenance", "Petty cash"]), amount: pick([150, 300, 450, 600, 900]), memberName: null, memberId: null, paymentId: null, recordedBy: deskUser, locationId: pick(branches), createdAt: new Date(now.getTime() - Math.floor(rand() * 100) * DAY) });
  }

  await Member.insertMany(memberDocs);
  await ScheduledClass.insertMany(scheduled);
  await NonUserBooking.insertMany(nonUserBookings);
  await Payment.insertMany(payments.filter((p) => p.paymentTime <= now));
  await Refund.insertMany(refunds);
  await DeductionLog.insertMany(deductionLogs);
  await ReceivedEmail.insertMany([
    { from: "Bank Misr <statements@bank.example.com>", to: "finance@the-mind-space.com", recipientEmail: "finance@the-mind-space.com", recipientUser: staff[0]._id, subject: "Monthly statement ready", text: "Your monthly statement is ready.", html: "", date: new Date(now.getTime() - DAY), messageId: "demo-1", isRead: false },
    { from: "Geidea <reports@geidea.example.com>", to: "finance@the-mind-space.com", recipientEmail: "finance@the-mind-space.com", recipientUser: staff[0]._id, subject: "Settlement report", text: "Settlement report attached.", html: "", date: new Date(now.getTime() - 3 * DAY), messageId: "demo-2", isRead: true },
  ]);

  console.log({
    payments: payments.length,
    refunds: refunds.length,
    scheduledClasses: scheduled.length,
    members: memberDocs.length,
    deductionLogs: deductionLogs.length,
    nonUserBookings: nonUserBookings.length,
  });
  console.log("Logins (password Password123!): accountant 01000000077, management 01000000078, branch admin 01000000079");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
