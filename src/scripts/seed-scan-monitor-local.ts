/**
 * Creates (or removes) test data in a LOCAL database for manually exercising
 * the Scans Monitor row edit/delete actions. Refuses to run against a
 * non-local MONGO_URI.
 *
 * Seed:    npx ts-node src/scripts/seed-scan-monitor-local.ts
 * Cleanup: npx ts-node src/scripts/seed-scan-monitor-local.ts --cleanup
 *
 * Everything is dated "today" so the rows show up on the monitor's default
 * view — re-run to move them to the current day.
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
import DailyAttendance from "../models/dailyAttendance";
import { cairoDateKey, toStoredPackageDate } from "../utils/timezone";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TAG = "[SCAN TEST]";
const PASSWORD = "ScanTest123!";

const ADMIN_PHONE = "01099991000";
const PHONES = {
  pt: "01099991001",
  ptOther: "01099991002",
  gym: "01099991003",
  studio: "01099991004",
};

async function cleanup() {
  const phones = [ADMIN_PHONE, ...Object.values(PHONES)];
  const users = await User.find({ phoneNumber: { $in: phones } });
  const ids = users.map((u) => u._id);
  await Member.deleteMany({ uid: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });

  const classes = await Class.find({ title: new RegExp(`^\\${TAG}`) });
  await ScheduledClass.deleteMany({ cid: { $in: classes.map((c) => c._id) } });
  await Class.deleteMany({ _id: { $in: classes.map((c) => c._id) } });
  await Package.deleteMany({ name: new RegExp(`^\\${TAG}`) });

  // Drop only the rows this fixture added, leaving any real ones in place.
  await DailyAttendance.updateMany(
    {},
    {
      $pull: {
        ptAttendance: { uid: { $in: ids } },
        openGymAttendance: {
          $or: [{ uid: { $in: ids } }, { guestPhone: "01099991099" }],
        },
      },
    } as any,
  );
}

/** Mongoose hashes the password on save, so create() (not insertMany). */
async function makeUser(name: string, phoneNumber: string, role: string) {
  return User.create({
    email: `${phoneNumber}@scan-test.local`,
    password: PASSWORD,
    name: `${TAG} ${name}`,
    phoneNumber,
    role,
  });
}

function holding(pkg: any, remaining: number, locationId: Types.ObjectId) {
  return {
    pkgId: pkg._id,
    name: pkg.name,
    pkgStartDate: toStoredPackageDate(new Date(Date.now() - 10 * DAY)),
    pkgEndDate: toStoredPackageDate(new Date(Date.now() + 20 * DAY)),
    status: "ACTIVE",
    remainingClasses: remaining,
    adjustmentHistory: [],
    locationId,
  };
}

async function main() {
  const uri = process.env.MONGO_URI ?? "";
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
    throw new Error(
      `Refusing to run: MONGO_URI is not a local database (${uri || "unset"})`,
    );
  }
  await mongoose.connect(uri);

  try {
    await cleanup();
    if (process.argv.includes("--cleanup")) {
      console.log("Scan Monitor test data removed.");
      return;
    }

    const location =
      (await Location.findOne({ branchName: "Cairo" })) ??
      (await Location.findOne());
    if (!location) throw new Error("No location found in local DB");
    const locationId = location._id as Types.ObjectId;

    // Anchor everything to midday on today's LOCAL calendar date. "Now minus a
    // few hours" breaks when the machine is behind UTC: in the small hours the
    // rows land in yesterday's UTC bucket and the monitor shows nothing.
    const anchor = new Date();
    anchor.setHours(12, 0, 0, 0);
    const at = (minutesBefore: number) =>
      new Date(anchor.getTime() - minutesBefore * 60 * 1000);

    const admin = await makeUser("Front Desk", ADMIN_PHONE, "admin");
    const ptUser = await makeUser("PT Member", PHONES.pt, "member");
    const ptOtherUser = await makeUser("PT Member Two", PHONES.ptOther, "member");
    const gymUser = await makeUser("Gym Member", PHONES.gym, "member");
    const studioUser = await makeUser("Studio Member", PHONES.studio, "member");

    // Categories must match what the scan flows look for — the generic demo
    // seed uses display-style categories that those lookups never find.
    const studioClass = await Class.create({
      title: `${TAG} Mat Pilates`,
      category: "STUDIO",
      price: 450,
      locations: [locationId],
      points: 1,
    });

    const ptPkg = await Package.create({
      name: `${TAG} 10 PT with Zeina`,
      numberOfSessions: 10,
      price: 9000,
      expiryPeriod: 60,
      category: "PERSONAL_TRAINING",
      opensClasses: [],
      locationId,
    });
    const ptPkgAlt = await Package.create({
      name: `${TAG} 24 PT with Hana`,
      numberOfSessions: 24,
      price: 18000,
      expiryPeriod: 90,
      category: "PERSONAL_TRAINING",
      opensClasses: [],
      locationId,
    });
    const gymPkg = await Package.create({
      name: `${TAG} 1 Month Open Gym`,
      numberOfSessions: 30,
      price: 3000,
      expiryPeriod: 30,
      category: "OPEN_GYM",
      opensClasses: [],
      locationId,
    });
    const studioPkg = await Package.create({
      name: `${TAG} Studio 10`,
      numberOfSessions: 10,
      price: 5000,
      expiryPeriod: 30,
      category: "STUDIO",
      opensClasses: [studioClass._id],
      locationId,
    });

    // Remaining counts are already net of the check-ins seeded below, so the
    // numbers add up when a session is returned.
    const ptMember = await Member.create({
      uid: ptUser._id,
      packages: [holding(ptPkg, 7, locationId)],
      bookings: [],
      ptAttendance: [
        {
          pkgId: ptPkg._id,
          attendanceTime: at(120),
          date: cairoDateKey(anchor),
        },
      ],
    });
    await Member.create({
      uid: ptOtherUser._id,
      packages: [holding(ptPkgAlt, 20, locationId)],
      bookings: [],
    });
    await Member.create({
      uid: gymUser._id,
      packages: [holding(gymPkg, 25, locationId)],
      bookings: [],
    });

    const session = await ScheduledClass.create({
      cid: studioClass._id,
      locationId,
      startTime: at(60),
      endTime: at(-60),
      availableSlots: 12,
      bookedMembers: [{ uid: studioUser._id, method: studioPkg.name }],
      scans: [
        {
          uid: studioUser._id,
          scanTime: at(70),
          method: studioPkg.name,
          status: true,
        },
        {
          uid: gymUser._id,
          scanTime: at(65),
          method: "No Active Package",
          status: false,
        },
      ],
    });

    await Member.create({
      uid: studioUser._id,
      packages: [holding(studioPkg, 9, locationId)],
      bookings: [
        {
          scid: session._id,
          bookingTime: new Date(Date.now() - 2 * DAY),
          isDropIn: false,
        },
      ],
      attendance: [{ scid: session._id }],
    });

    // The daily document the monitor reads is keyed on UTC midnight.
    const dayStart = new Date(anchor);
    dayStart.setUTCHours(0, 0, 0, 0);
    await DailyAttendance.findOneAndUpdate(
      { date: dayStart },
      {
        $setOnInsert: { date: dayStart },
        $push: {
          ptAttendance: {
            $each: [
              {
                uid: ptUser._id,
                time: at(120),
                method: ptPkg.name,
                status: "SUCCESS",
                locationId,
                pkgId: ptPkg._id,
              },
            ],
          },
          openGymAttendance: {
            $each: [
              {
                uid: gymUser._id,
                time: at(180),
                method: gymPkg.name,
                status: "SUCCESS",
                locationId,
                pkgId: gymPkg._id,
              },
              {
                // A legacy-shaped row: no pkgId, so the correction has to
                // resolve the package from its name.
                uid: ptUser._id,
                time: at(240),
                method: gymPkg.name,
                status: "SUCCESS",
                locationId,
              },
              {
                guestName: `${TAG} Walk-in Guest`,
                guestPhone: "01099991099",
                time: at(90),
                method: "Drop In",
                status: "SUCCESS",
                locationId,
              },
            ],
          },
        },
      },
      { upsert: true, new: true },
    );

    console.log(`
Scan Monitor test data created in ${uri}

Log in as   : phone ${ADMIN_PHONE}   password ${PASSWORD}
Branch      : ${location.branchName}

Personal Training card
  ${TAG} PT Member        ${ptPkg.name}       7 left  (SUCCESS)

Open Gym card
  ${TAG} Gym Member       ${gymPkg.name}     25 left  (SUCCESS)
  ${TAG} PT Member        ${gymPkg.name}              (SUCCESS, no pkgId - legacy row)
  ${TAG} Walk-in Guest    Drop In                     (guest row, name/phone editable)

Class card: ${TAG} Mat Pilates (${anchor.toDateString()}, 11:00-13:00 local)
  ${TAG} Studio Member    ${studioPkg.name}   9 left  (SUCCESS)
  ${TAG} Gym Member       No Active Package           (FAILED)

Reassign target for the swap flow:
  ${TAG} PT Member Two    ${ptPkgAlt.name}   20 left

member ids: pt=${ptMember.uid} admin=${admin._id}
`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
