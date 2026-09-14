/**
 * Creates (or removes) test data in a LOCAL database for manually testing the
 * late-cancellation policy. Refuses to run against a non-local MONGO_URI.
 *
 * Seed:    npx ts-node src/scripts/seed-late-cancellation-local.ts
 * Cleanup: npx ts-node src/scripts/seed-late-cancellation-local.ts --cleanup
 *
 * Session times are relative to when you run it — re-run to refresh them.
 */

import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", "..", "dev.env") });

import mongoose, { Types } from "mongoose";
import Class from "../models/class";
import Location from "../models/location";
import User from "../models/user";
import Package from "../models/package";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";

const HOUR = 60 * 60 * 1000;
const MEMBER_PHONE = "01099990001";
const ADMIN_PHONE = "01099990002";
const PASSWORD = "LateCancel123!";
const TAG = "[LATE-CANCEL TEST]";

async function cleanup() {
  const users = await User.find({ phoneNumber: { $in: [MEMBER_PHONE, ADMIN_PHONE] } });
  await Member.deleteMany({ uid: { $in: users.map((u) => u._id) } });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  const classes = await Class.find({ title: new RegExp(`^\\${TAG}`) });
  await ScheduledClass.deleteMany({ cid: { $in: classes.map((c) => c._id) } });
  await Class.deleteMany({ _id: { $in: classes.map((c) => c._id) } });
  await Package.deleteMany({ name: new RegExp(`^\\${TAG}`) });
}

async function main() {
  const uri = process.env.MONGO_URI ?? "";
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
    throw new Error(`Refusing to run: MONGO_URI is not a local database (${uri || "unset"})`);
  }
  await mongoose.connect(uri);

  try {
    await cleanup();
    if (process.argv.includes("--cleanup")) {
      console.log("Test data removed.");
      return;
    }

    const location =
      (await Location.findOne({ branchName: "Cairo" })) ?? (await Location.findOne());
    if (!location) throw new Error("No location found in local DB");

    const nameArg = process.argv.indexOf("--name");
    const memberName =
      nameArg > -1 && process.argv[nameArg + 1] ? process.argv[nameArg + 1] : `${TAG} Member`;
    const member = await User.create({
      email: "late-cancel-member@test.local",
      password: PASSWORD,
      name: memberName,
      phoneNumber: MEMBER_PHONE,
      role: "member",
    });
    await User.create({
      email: "late-cancel-admin@test.local",
      password: PASSWORD,
      name: `${TAG} Admin`,
      phoneNumber: ADMIN_PHONE,
      role: "admin",
    });

    const paid = await Class.create({
      title: `${TAG} Pilates`,
      category: "STUDIO",
      price: 450,
      locations: [location._id],
      points: 1,
    });
    const free = await Class.create({
      title: `${TAG} Free Stretch`,
      category: "STUDIO",
      price: 0,
      locations: [location._id],
      points: 1,
    });
    const pkg = await Package.create({
      name: `${TAG} Studio 10`,
      numberOfSessions: 10,
      price: 5000,
      expiryPeriod: 30,
      category: "STUDIO",
      opensClasses: [paid._id, free._id],
      locationId: location._id,
    });
    await Member.create({
      uid: member._id,
      packages: [
        {
          pkgId: pkg._id,
          name: pkg.name,
          pkgStartDate: new Date(Date.now() - 24 * HOUR),
          pkgEndDate: new Date(Date.now() + 30 * 24 * HOUR),
          status: "ACTIVE",
          remainingClasses: 10,
          adjustmentHistory: [],
          locationId: location._id,
        },
      ],
      bookings: [],
    });

    const session = (cid: Types.ObjectId, hours: number) =>
      ScheduledClass.create({
        cid,
        locationId: location._id,
        startTime: new Date(Date.now() + hours * HOUR),
        endTime: new Date(Date.now() + (hours + 1) * HOUR),
        availableSlots: 10,
        bookedMembers: [],
      });

    const early = await session(paid._id as Types.ObjectId, 5);
    // 2h45m: already inside the 3h window, leaves time to test before it starts
    const late = await session(paid._id as Types.ObjectId, 2.75);
    const staff = await session(paid._id as Types.ObjectId, 2);
    const freeLate = await session(free._id as Types.ObjectId, 2);

    const fmt = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Africa/Cairo" });
    console.log(`
Test data created in ${uri}

Member       : ${memberName}
Member login : phone ${MEMBER_PHONE}  password ${PASSWORD}
Admin login  : phone ${ADMIN_PHONE}  password ${PASSWORD}
Member uid   : ${member._id}
Package      : ${pkg.name} (10 sessions)

SCID_EARLY = ${early._id}   paid, starts ${fmt(early.startTime)} (in 5h)
SCID_LATE  = ${late._id}   paid, starts ${fmt(late.startTime)} (in 2h45m)
SCID_STAFF = ${staff._id}   paid, starts ${fmt(staff.startTime)} (in 2h)
SCID_FREE  = ${freeLate._id}   free, starts ${fmt(freeLate.startTime)} (in 2h)
`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
