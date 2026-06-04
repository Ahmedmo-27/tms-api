/**
 * Dev-only: seeds a coach, two scheduled classes, books Mohammed for them,
 * marks one as attended. Lets the admin dashboard show real attendance data.
 *
 * Run from tms_api/:
 *   npx ts-node src/scripts/seed-dev-attendance.ts
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose, { Types } from "mongoose";
import connectDB from "../config/db";
import Class from "../models/class";
import Coach from "../models/coach";
import ScheduledClass from "../models/scheduledClass";
import User from "../models/user";
import Member from "../models/member";

async function run() {
  await connectDB();

  // 1. Coach
  let coach = await Coach.findOne({ coachName: "Demo Coach" });
  if (!coach) {
    coach = await Coach.create({
      coachName: "Demo Coach",
      phoneNumber: "01000000099",
      bio: "Seeded for dev",
    });
    console.log("Created coach:", (coach._id as Types.ObjectId).toString());
  } else {
    console.log("Coach exists:", (coach._id as Types.ObjectId).toString());
  }

  // 2. Class template
  const classDoc = await Class.findOne({ title: /Pilates Beginner/i });
  if (!classDoc) {
    throw new Error("No class template found. Run seed-classes.ts first.");
  }
  console.log("Class:", classDoc.title, (classDoc._id as Types.ObjectId).toString());

  // 3. Member: Mohammed (01022138836)
  const user = await User.findOne({ phoneNumber: "01022138836" });
  if (!user) throw new Error("Mohammed user not found");
  const member = await Member.findOne({ uid: user._id });
  if (!member) throw new Error("Mohammed member doc not found");
  console.log("Member:", user.name, (user._id as Types.ObjectId).toString());

  // Pick the first active package with remaining classes
  const pkg = member.packages.find(
    (p) => (p.status as string).toUpperCase() === "ACTIVE" && p.remainingClasses > 0
  );
  if (!pkg) throw new Error("Mohammed has no active package");
  console.log("Using package:", pkg.pkgId.toString(), "remaining:", pkg.remainingClasses);

  const now = new Date();
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow

  // 4. Past scheduled class (will mark attended)
  let pastSc = await ScheduledClass.findOne({
    cid: classDoc._id,
    startTime: past,
  });
  if (!pastSc) {
    pastSc = await ScheduledClass.create({
      cid: classDoc._id,
      coachId: coach._id,
      startTime: past,
      endTime: new Date(past.getTime() + 60 * 60 * 1000),
      availableSlots: 25,
      bookedSlots: 0,
    });
    console.log("Created past scheduled class:", (pastSc._id as Types.ObjectId).toString());
  } else {
    console.log("Past sc exists:", (pastSc._id as Types.ObjectId).toString());
  }

  // 5. Future scheduled class (just booked, not attended)
  let futureSc = await ScheduledClass.findOne({
    cid: classDoc._id,
    startTime: future,
  });
  if (!futureSc) {
    futureSc = await ScheduledClass.create({
      cid: classDoc._id,
      coachId: coach._id,
      startTime: future,
      endTime: new Date(future.getTime() + 60 * 60 * 1000),
      availableSlots: 25,
      bookedSlots: 0,
    });
    console.log("Created future scheduled class:", (futureSc._id as Types.ObjectId).toString());
  } else {
    console.log("Future sc exists:", (futureSc._id as Types.ObjectId).toString());
  }

  // Use direct $push updates to bypass legacy-data schema validation issues
  const today = new Date().toISOString().split("T")[0];

  const hasPastBooking = member.bookings.some(
    (b) => b.scid.toString() === (pastSc._id as Types.ObjectId).toString()
  );
  if (!hasPastBooking) {
    await Member.updateOne(
      { _id: member._id },
      {
        $push: {
          bookings: { scid: pastSc._id, bookingTime: past, isDropIn: false },
        },
      },
      { runValidators: false }
    );
    console.log("Added past booking");
  }

  const hasFutureBooking = member.bookings.some(
    (b) => b.scid.toString() === (futureSc._id as Types.ObjectId).toString()
  );
  if (!hasFutureBooking) {
    await Member.updateOne(
      { _id: member._id },
      {
        $push: {
          bookings: {
            scid: futureSc._id,
            bookingTime: new Date(),
            isDropIn: false,
          },
        },
      },
      { runValidators: false }
    );
    console.log("Added future booking");
  }

  const hasPastAttendance = member.attendance.some(
    (a) => a.scid.toString() === (pastSc._id as Types.ObjectId).toString()
  );
  if (!hasPastAttendance) {
    await Member.updateOne(
      { _id: member._id },
      { $push: { attendance: { scid: pastSc._id } } },
      { runValidators: false }
    );
    console.log("Added past attendance");
  }

  const ptPkg = member.packages.find(
    (p) => (p.status as string).toUpperCase() === "ACTIVE" && p.remainingClasses > 0
  );
  if (ptPkg) {
    const hasPtToday = member.ptAttendance.some(
      (p) => p.pkgId.toString() === ptPkg.pkgId.toString() && p.date === today
    );
    if (!hasPtToday) {
      await Member.updateOne(
        { _id: member._id },
        {
          $push: {
            ptAttendance: {
              pkgId: ptPkg.pkgId,
              attendanceTime: new Date(),
              date: today,
            },
          },
        },
        { runValidators: false }
      );
      console.log("Added PT attendance for today");
    }
  }
  console.log("\n✓ Mohammed now has bookings + attendance.");
  console.log("View at: http://localhost:3000/dashboard/our-members/" + user._id);
  console.log("       : http://localhost:3000/dashboard/our-members/" + user._id + "/attendance");
  console.log("       : http://localhost:3000/dashboard/attendance");

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
