/**
 * End-to-end local verification of the late-cancellation policy
 * (in-memory MongoDB replica set, real transactions, real controllers).
 * Never touches a real database.
 *
 * Run: npx ts-node src/scripts/verify-late-cancellation-local.ts
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";
import Class from "../models/class";
import Location from "../models/location";
import User from "../models/user";
import Package from "../models/package";
import Member from "../models/member";
import ScheduledClass from "../models/scheduledClass";
import { BookingsService } from "../services/bookings-service";
import * as clientController from "../controllers/client/class-controller";
import * as adminController from "../controllers/admin/class-controller";

const HOUR = 60 * 60 * 1000;
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

type Captured = { status: number; body: any; error?: any };

/** Invokes an asyncHandler-wrapped controller and captures the JSON or the thrown error. */
function callController(handler: any, req: any): Promise<Captured> {
  return new Promise((resolve) => {
    const captured: Captured = { status: 0, body: undefined };
    const res: any = {
      status(code: number) {
        captured.status = code;
        return res;
      },
      json(body: any) {
        captured.body = body;
        resolve(captured);
        return res;
      },
    };
    handler(req, res, (err: any) => {
      captured.error = err;
      resolve(captured);
    });
  });
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  try {
    const location = await Location.create({
      branchName: "New Cairo",
      location: "New Cairo",
      locationUrl: "https://example.com",
    });
    const user = await User.create({
      email: "late-cancel@test.local",
      password: "Password123!",
      name: "Late Cancel Tester",
      phoneNumber: "01000000000",
      role: "member",
    });
    const uid = String(user._id);

    const paidClass = await Class.create({
      title: "Mat Pilates",
      category: "STUDIO",
      price: 450,
      locations: [location._id],
      points: 1,
    });
    const freeClass = await Class.create({
      title: "Free Stretch",
      category: "STUDIO",
      price: 0,
      locations: [location._id],
      points: 1,
    });
    const pkg = await Package.create({
      name: "Studio 10",
      numberOfSessions: 10,
      price: 5000,
      expiryPeriod: 30,
      category: "STUDIO",
      opensClasses: [paidClass._id, freeClass._id],
    });
    const pkgStartDate = new Date(Date.now() - 24 * HOUR);
    await Member.create({
      uid: user._id,
      packages: [
        {
          pkgId: pkg._id,
          name: pkg.name,
          pkgStartDate,
          pkgEndDate: new Date(Date.now() + 30 * 24 * HOUR),
          status: "ACTIVE",
          remainingClasses: 10,
          adjustmentHistory: [],
        },
      ],
      bookings: [],
    });

    const makeSession = async (cid: Types.ObjectId, hoursUntilStart: number) =>
      ScheduledClass.create({
        cid,
        locationId: location._id,
        startTime: new Date(Date.now() + hoursUntilStart * HOUR),
        endTime: new Date(Date.now() + (hoursUntilStart + 1) * HOUR),
        availableSlots: 10,
        bookedMembers: [],
      });

    const memberState = async (scid: string) => {
      const m = await Member.findOne({ uid: user._id }).lean();
      const p = m!.packages[0];
      const sc = await ScheduledClass.findById(scid).lean();
      return {
        remaining: p.remainingClasses,
        status: p.status,
        history: p.adjustmentHistory ?? [],
        hasBooking: m!.bookings.some((b: any) => b.scid.toString() === scid),
        inClass: (sc?.bookedMembers ?? []).some((b: any) => b.uid.toString() === uid),
        slots: sc?.availableSlots,
      };
    };

    const memberReq = (scid: string) => ({
      params: { scid },
      user: { _id: uid, role: "member" },
      body: {},
      query: {},
    });

    // ── A: book 5h ahead, cancel early → session returned ────────────────
    console.log("\nA) Member cancels more than 3h before");
    const a = await makeSession(paidClass._id as Types.ObjectId, 5);
    const aScid = String(a._id);
    const aBook = await callController(clientController.bookClass, memberReq(aScid));
    check("booking succeeds", aBook.status === 200, aBook.error?.message ?? "");
    check(
      "booking response says it uses a package session",
      aBook.body?.data?.usesPackageSession === true,
    );
    const expectedDeadline = new Date(a.startTime.getTime() - 3 * HOUR).toISOString();
    check(
      "booking response has deadline = start - 3h",
      aBook.body?.data?.cancellationDeadline === expectedDeadline,
      `${aBook.body?.data?.cancellationDeadline} vs ${expectedDeadline}`,
    );
    let s = await memberState(aScid);
    check("session deducted at booking (10 → 9)", s.remaining === 9, `remaining=${s.remaining}`);

    const aCancel = await callController(clientController.cancelClass, memberReq(aScid));
    check("cancel succeeds", aCancel.status === 200, aCancel.error?.message ?? "");
    check("normal message", aCancel.body?.message === "Class Canceled!", aCancel.body?.message);
    check("response lateCancellation=false", aCancel.body?.data?.lateCancellation === false);
    s = await memberState(aScid);
    check("session returned (9 → 10)", s.remaining === 10, `remaining=${s.remaining}`);
    check("booking removed from member", !s.hasBooking);
    check("member removed from class & slot freed", !s.inClass && s.slots === 10, `slots=${s.slots}`);

    // ── B: book 2h ahead, member cancels → session NOT returned ──────────
    console.log("\nB) Member cancels within 3h");
    const b = await makeSession(paidClass._id as Types.ObjectId, 2);
    const bScid = String(b._id);
    const bBook = await callController(clientController.bookClass, memberReq(bScid));
    check("booking succeeds", bBook.status === 200, bBook.error?.message ?? "");
    s = await memberState(bScid);
    check("session deducted at booking (10 → 9)", s.remaining === 9, `remaining=${s.remaining}`);
    const historyBefore = s.history.length;

    const bCancel = await callController(clientController.cancelClass, memberReq(bScid));
    check("cancel succeeds (no longer blocked)", bCancel.status === 200, bCancel.error?.message ?? "");
    check(
      "late-cancel message",
      typeof bCancel.body?.message === "string" && bCancel.body.message.includes("within 3 hours"),
      bCancel.body?.message,
    );
    check("response lateCancellation=true", bCancel.body?.data?.lateCancellation === true);
    s = await memberState(bScid);
    check("session NOT returned (stays 9)", s.remaining === 9, `remaining=${s.remaining}`);
    check("booking removed from member", !s.hasBooking);
    check("member removed from class & slot freed", !s.inClass && s.slots === 10, `slots=${s.slots}`);
    const note = s.history[s.history.length - 1] as any;
    check(
      "late-cancellation note added to package history",
      s.history.length === historyBefore + 1 &&
        note?.amount === 0 &&
        note?.source === "MEMBER_CANCELLATION" &&
        String(note?.reason).includes("Late cancellation"),
      JSON.stringify({ amount: note?.amount, source: note?.source, reason: note?.reason }),
    );

    // ── C: staff cancel within 3h → session returned ────────────────────
    console.log("\nC) Staff cancel within 3h");
    const c = await makeSession(paidClass._id as Types.ObjectId, 2);
    const cScid = String(c._id);
    await callController(clientController.bookClass, memberReq(cScid));
    s = await memberState(cScid);
    check("session deducted at booking (9 → 8)", s.remaining === 8, `remaining=${s.remaining}`);
    const cCancel = await callController(adminController.cancelBooking, {
      params: {},
      body: { uid, scid: cScid },
      query: {},
      user: { _id: new Types.ObjectId().toString(), role: "admin" },
      headers: {},
    });
    check("staff cancel succeeds", cCancel.status === 200, cCancel.error?.message ?? "");
    s = await memberState(cScid);
    check("session returned (8 → 9)", s.remaining === 9, `remaining=${s.remaining}`);
    const staffNote = s.history[s.history.length - 1] as any;
    check(
      "history records front-desk refund",
      staffNote?.source === "FRONTDESK_CANCELLATION" && staffNote?.type === "ADD",
      JSON.stringify({ source: staffNote?.source, type: staffNote?.type }),
    );

    // ── D: class already started → member can't cancel ──────────────────
    console.log("\nD) Class already started");
    const d = await ScheduledClass.create({
      cid: paidClass._id,
      locationId: location._id,
      startTime: new Date(Date.now() - 10 * 60 * 1000),
      endTime: new Date(Date.now() + 50 * 60 * 1000),
      availableSlots: 10,
      bookedMembers: [],
    });
    const dScid = String(d._id);
    await BookingsService.addBooking(uid, dScid, true, "admin");
    s = await memberState(dScid);
    const dRemaining = s.remaining;
    const dCancel = await callController(clientController.cancelClass, memberReq(dScid));
    check(
      "cancel rejected with CLASS_ALREADY_STARTED",
      dCancel.error?.code === "CLASS_ALREADY_STARTED",
      dCancel.error?.code ?? `status=${dCancel.status}`,
    );
    s = await memberState(dScid);
    check("booking kept, package unchanged", s.hasBooking && s.remaining === dRemaining);

    // ── E: free class within 3h ─────────────────────────────────────────
    console.log("\nE) Free class within 3h");
    const e = await makeSession(freeClass._id as Types.ObjectId, 2);
    const eScid = String(e._id);
    const before = (await memberState(eScid)).remaining;
    const eBook = await callController(clientController.bookClass, memberReq(eScid));
    check("booking succeeds", eBook.status === 200, eBook.error?.message ?? "");
    check("booking response usesPackageSession=false", eBook.body?.data?.usesPackageSession === false);
    const eCancel = await callController(clientController.cancelClass, memberReq(eScid));
    check("cancel succeeds", eCancel.status === 200, eCancel.error?.message ?? "");
    check("response lateCancellation=false", eCancel.body?.data?.lateCancellation === false);
    s = await memberState(eScid);
    check("package unchanged", s.remaining === before, `remaining=${s.remaining}`);
    check("booking removed", !s.hasBooking && !s.inClass);

    // ── F: drop-in within 3h → still blocked ────────────────────────────
    console.log("\nF) Drop-in within 3h");
    const f = await makeSession(paidClass._id as Types.ObjectId, 2);
    const fScid = String(f._id);
    await Member.updateOne(
      { uid: user._id },
      { $push: { bookings: { scid: f._id, bookingTime: new Date(), isDropIn: true } } },
    );
    const fCancel = await callController(clientController.cancelClass, memberReq(fScid));
    check(
      "drop-in cancel rejected with DEADLINE_PASSED",
      fCancel.error?.code === "DEADLINE_PASSED",
      fCancel.error?.code ?? `status=${fCancel.status}`,
    );
    s = await memberState(fScid);
    check("drop-in booking kept", s.hasBooking);

    // ── G: cancel early, rebook, then no-show → session stays used ──────
    console.log("\nG) No scan (no-show) keeps the session used");
    const g = await makeSession(paidClass._id as Types.ObjectId, 5);
    const gScid = String(g._id);
    const gBefore = (await memberState(gScid)).remaining;
    await callController(clientController.bookClass, memberReq(gScid));
    // class passes without a scan — nothing should give the session back
    await ScheduledClass.updateOne(
      { _id: g._id },
      { startTime: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() - HOUR) },
    );
    s = await memberState(gScid);
    check("session still used after no-show", s.remaining === gBefore - 1, `remaining=${s.remaining}`);
    const gCancel = await callController(clientController.cancelClass, memberReq(gScid));
    check(
      "no-show can't cancel afterwards to get it back",
      gCancel.error?.code === "CLASS_ALREADY_STARTED",
      gCancel.error?.code ?? `status=${gCancel.status}`,
    );
  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
