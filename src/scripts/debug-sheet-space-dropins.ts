import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", "dev.env") });
import mongoose from "mongoose";
import { cairoDayRange } from "../utils/timezone";

const LOCATION = "69ec4abad8394559ce7ca77c";

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  const db = mongoose.connection.db!;
  const payments = db.collection("payments");
  const attendance = db.collection("dailyattendances");
  const locations = db.collection("locations");

  const loc = await locations.findOne({
    _id: new mongoose.Types.ObjectId(LOCATION),
  });
  console.log("branch", loc?.branchName, String(loc?._id));

  for (const date of ["2026-08-20", "2026-08-21", "2026-08-22"]) {
    const { start, end } = cairoDayRange(date);
    console.log("\n===", date, start.toISOString(), "->", end.toISOString());

    const dayPayments = await payments
      .find({
        paymentTime: { $gte: start, $lt: end },
        amount: { $gt: 0 },
        isRefunded: { $ne: true },
      })
      .project({
        amount: 1,
        purpose: 1,
        paymentMethod: 1,
        paymentTime: 1,
        locationId: 1,
        scid: 1,
        uid: 1,
        nonMemberName: 1,
        note: 1,
        pkgId: 1,
      })
      .toArray();

    const atLoc = dayPayments.filter(
      (p) => String(p.locationId) === LOCATION,
    );
    const dropins = dayPayments.filter((p) => p.purpose === "DROPIN");
    const dropinsNoScid = dropins.filter((p) => !p.scid);
    const dropinsAtLoc = dropins.filter(
      (p) => String(p.locationId) === LOCATION,
    );

    console.log(
      "payments in cairo day",
      dayPayments.length,
      "at loc",
      atLoc.length,
      "DROPIN",
      dropins.length,
      "DROPIN no scid",
      dropinsNoScid.length,
      "DROPIN at loc",
      dropinsAtLoc.length,
    );

    for (const p of dropinsAtLoc) {
      console.log("  dropin", {
        name: p.nonMemberName || String(p.uid || ""),
        amount: p.amount,
        method: p.paymentMethod,
        time: p.paymentTime,
        loc: String(p.locationId || ""),
        scid: p.scid ? String(p.scid) : "",
        note: p.note,
        locType: typeof p.locationId,
      });
    }

    const attStart = new Date(start.getTime() - 36 * 3600 * 1000);
    const attEnd = new Date(end.getTime() + 36 * 3600 * 1000);
    const docs = await attendance
      .find({ date: { $gte: attStart, $lt: attEnd } })
      .toArray();

    let og = 0;
    let ogDrop = 0;
    for (const doc of docs) {
      for (const e of doc.openGymAttendance || []) {
        const t = e.time ? new Date(e.time) : null;
        if (!t || t < start || t >= end) continue;
        og += 1;
        const method = String(e.method || "");
        if (/drop/i.test(method)) {
          ogDrop += 1;
          console.log("  og drop-in", {
            guest: e.guestName,
            uid: e.uid ? String(e.uid) : "",
            method,
            time: e.time,
            loc: e.locationId ? String(e.locationId) : "",
            docDate: doc.date,
          });
        }
      }
    }
    console.log("og entries on cairo day", og, "drop-in methods", ogDrop);
  }

  const joumana = await payments
    .find({
      $or: [
        { nonMemberName: /joumana/i },
        { note: /joumana/i },
      ],
    })
    .project({
      amount: 1,
      purpose: 1,
      paymentTime: 1,
      locationId: 1,
      scid: 1,
      nonMemberName: 1,
      note: 1,
      paymentMethod: 1,
    })
    .sort({ paymentTime: -1 })
    .limit(5)
    .toArray();
  console.log("\njoumana payments", joumana);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
