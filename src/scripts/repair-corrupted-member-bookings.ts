import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import Member from "../models/member";
import User from "../models/user";
import ScheduledClass from "../models/scheduledClass";

// ============================================================================
// CONFIGURATION
// ============================================================================
// DRY_RUN mode is strictly enforced to preview changes without modifying the database.
const DRY_RUN = true;

async function main() {
  dotenv.config({ path: path.join(__dirname, "../../prod.env") });
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI not found in prod.env");
  }

  console.log("=================================================================");
  console.log(`REPAIR CORRUPTED MEMBER BOOKINGS - ${DRY_RUN ? "DRY RUN (READ ONLY)" : "LIVE EXECUTION"}`);
  console.log("=================================================================\n");

  await mongoose.connect(uri, {
    readPreference: DRY_RUN ? "secondaryPreferred" : "primary",
  });

  const members = await Member.find({}).lean();
  console.log(`Inspecting ${members.length} members in database...\n`);

  let affectedMembersCount = 0;
  let totalCorruptedBookings = 0;
  const repairPlan: Array<{
    memberId: string;
    uid: string;
    userName?: string;
    phoneNumber?: string;
    bookingId: string;
    scid?: string;
    currentFields: any;
    patchedFields: { isDropIn: boolean; bookingTime: Date };
  }> = [];

  for (const m of members) {
    if (!m.bookings || !m.bookings.length) continue;

    const corrupted = m.bookings.filter(
      (b: any) => b.isDropIn === undefined || b.isDropIn === null || !b.bookingTime
    );

    if (corrupted.length > 0) {
      affectedMembersCount++;
      const user = await User.findById(m.uid).lean();

      for (const b of corrupted as any[]) {
        totalCorruptedBookings++;

        // Determine best bookingTime:
        // 1. From the subdocument's ObjectId timestamp if available
        // 2. Or from the ScheduledClass date if scid is valid
        // 3. Fallback to current date
        let resolvedBookingTime: Date;
        if (b._id && typeof b._id.getTimestamp === "function") {
          resolvedBookingTime = b._id.getTimestamp();
        } else if (b.scid) {
          const sc: any = await ScheduledClass.findById(b.scid).lean();
          resolvedBookingTime = sc?.startTime ? new Date(sc.startTime) : new Date();
        } else {
          resolvedBookingTime = new Date();
        }

        const patched = {
          isDropIn: b.isDropIn ?? false,
          bookingTime: b.bookingTime || resolvedBookingTime,
        };

        repairPlan.push({
          memberId: String(m._id),
          uid: String(m.uid),
          userName: user?.name,
          phoneNumber: user?.phoneNumber,
          bookingId: String(b._id),
          scid: b.scid ? String(b.scid) : undefined,
          currentFields: {
            scid: b.scid,
            cid: b.cid,
            isDropIn: b.isDropIn,
            bookingTime: b.bookingTime,
          },
          patchedFields: patched,
        });
      }
    }
  }

  console.log(`Found ${affectedMembersCount} affected member(s) with ${totalCorruptedBookings} corrupted booking record(s):\n`);

  for (const item of repairPlan) {
    console.log(`-----------------------------------------------------------------`);
    console.log(`Member: ${item.userName ?? "Unknown"} (${item.phoneNumber ?? "N/A"})`);
    console.log(`Member _id: ${item.memberId} | UID: ${item.uid}`);
    console.log(`Booking _id: ${item.bookingId} | Class SCID: ${item.scid ?? "N/A"}`);
    console.log(`Current state: `, JSON.stringify(item.currentFields));
    console.log(`Target state to patch: `, JSON.stringify(item.patchedFields));

    if (!DRY_RUN) {
      const res = await Member.updateOne(
        { _id: item.memberId, "bookings._id": item.bookingId },
        {
          $set: {
            "bookings.$.isDropIn": item.patchedFields.isDropIn,
            "bookings.$.bookingTime": item.patchedFields.bookingTime,
          },
        }
      );
      console.log(`[APPLIED] MongoDB update result: matched=${res.matchedCount}, modified=${res.modifiedCount}`);
    } else {
      console.log(`[DRY RUN] Would execute: Member.updateOne({ _id: "${item.memberId}", "bookings._id": "${item.bookingId}" }, { $set: { "bookings.$.isDropIn": ${item.patchedFields.isDropIn}, "bookings.$.bookingTime": ISODate("${item.patchedFields.bookingTime.toISOString()}") } })`);
    }
  }

  console.log(`\n=================================================================`);
  if (DRY_RUN) {
    console.log(`DRY RUN COMPLETED. 0 writes performed.`);
    console.log(`Total records identified for repair: ${totalCorruptedBookings} across ${affectedMembersCount} members.`);
  } else {
    console.log(`LIVE REPAIR COMPLETED. Successfully patched ${totalCorruptedBookings} records.`);
  }
  console.log(`=================================================================\n`);

  await mongoose.disconnect();
}

main().catch(console.error);
