import { Request, Response } from "express";
import { Types } from "mongoose";
import Member from "../../models/member";
import OwedPtSession from "../../models/owedPtSession";
import DailyAttendance from "../../models/dailyAttendance";
import Package from "../../models/package";
import NonUserPackage from "../../models/nonUserPackage";
import { PaymentsService } from "../../services/payments-service";
import { BookingsService } from "../../services/bookings-service";
import { BadRequestError, NotFoundError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";
import { resolveLocationFilter, resolveLocationIdForWrite } from "../../utils/location-scope";
import { runInTransaction } from "../../utils/transaction";
import { normalizePhoneNumber } from "../../utils/phone";
import { format } from "date-fns";

type AttendanceRow = {
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: "CLASS" | "PT";
  className: string;
  coachName?: string;
  refId: string;
  attendanceTime: Date;
};

export const getAttendanceHistory = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const {
    startDate,
    endDate,
    page = "1",
    limit = "25",
    type,
    memberName,
  } = req.query;

  const targetLocationId = resolveLocationFilter(req);

  const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNumber = Math.max(1, parseInt(limit as string, 10) || 25);

  const { startOfDateCairo, endOfDateCairo } = await import("../../utils/timezone");
  const start = startDate ? startOfDateCairo(startDate as string) : null;
  const end = endDate ? endOfDateCairo(endDate as string) : null;

  const members = await Member.find({ isActive: true })
    .populate("uid")
    .populate({
      path: "attendance.scid",
      model: "ScheduledClass",
      populate: [
        { path: "coachId", model: "Coach" },
        { path: "cid", model: "Class" },
      ],
    })
    .populate({ path: "ptAttendance.pkgId", model: "Package" });

  const rows: AttendanceRow[] = [];

  for (const member of members) {
    const user = member.uid as any;
    if (!user) continue;
    const name = user.name || "—";
    if (
      memberName &&
      !name.toLowerCase().includes((memberName as string).toLowerCase())
    ) {
      continue;
    }
    const phone = user.phoneNumber || "";
    const memberId = user._id?.toString() || "";

    if (type !== "PT") {
      for (const att of member.attendance || []) {
        const sc: any = att.scid;
        if (!sc || typeof sc !== "object") continue;
        if (targetLocationId && sc.locationId?.toString() !== targetLocationId) continue;
        const time: Date = sc.startTime ? new Date(sc.startTime) : new Date(0);
        if (start && time < start) continue;
        if (end && time > end) continue;
        rows.push({
          memberId,
          memberName: name,
          memberPhone: phone,
          type: "CLASS",
          className: sc.cid?.title || "—",
          coachName: Array.isArray(sc.coachId) ? sc.coachId.map((c: any) => c.name).filter(Boolean).join(", ") || undefined : (sc.coachId?.name || undefined),
          refId: sc._id?.toString() || "",
          attendanceTime: time,
        });
      }
    }

    if (type !== "CLASS") {
      for (const pt of member.ptAttendance || []) {
        const time: Date = pt.attendanceTime
          ? new Date(pt.attendanceTime)
          : new Date(0);
        if (start && time < start) continue;
        if (end && time > end) continue;
        const pkg: any = pt.pkgId;
        
        if (targetLocationId) {
          const memberPkg = member.packages?.find((p: any) => p.pkgId?.toString() === pkg?._id?.toString());
          if (!memberPkg || memberPkg.locationId?.toString() !== targetLocationId) continue;
        }
        rows.push({
          memberId,
          memberName: name,
          memberPhone: phone,
          type: "PT",
          className: pkg?.name || "PT Session",
          refId: pkg?._id?.toString() || "",
          attendanceTime: time,
        });
      }
    }
  }

  rows.sort(
    (a, b) => b.attendanceTime.getTime() - a.attendanceTime.getTime()
  );

  const total = rows.length;
  const skip = (pageNumber - 1) * limitNumber;
  const paged = rows.slice(skip, skip + limitNumber);

  new SuccessResponse("Attendance history fetched", {
    records: paged,
    total,
  }).send(res);
});

export const getOwedPtSessions = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const { phone, uid, status = "PENDING" } = req.query;

  const query: any = {};
  if (status && status !== "ALL") {
    query.status = status;
  }

  const orConditions: any[] = [];
  if (uid && Types.ObjectId.isValid(uid as string)) {
    orConditions.push({ uid: new Types.ObjectId(uid as string) });
  }
  if (phone) {
    const cleanPhone = normalizePhoneNumber(phone as string);
    orConditions.push({ phoneNumber: cleanPhone });
    if (cleanPhone.startsWith("0")) {
      orConditions.push({ phoneNumber: cleanPhone.slice(1) });
    }
  }

  if (orConditions.length > 0) {
    query.$or = orConditions;
  }

  const sessions = await OwedPtSession.find(query)
    .populate("coachId", "coachName name")
    .populate("locationId", "branchName location")
    .sort({ attendanceDate: -1 })
    .lean();

  new SuccessResponse("Owed PT Sessions retrieved", sessions).send(res);
});

export const settleOwedPtSession = asyncHandler(async function (
  req: Request,
  res: Response
): Promise<void> {
  const {
    sessionId,
    settlementType,
    paymentMethod,
    amount,
    paymentDate,
    pkgId,
    note,
  } = req.body;

  if (!sessionId) {
    throw new BadRequestError("SESSION_ID_REQUIRED", "Owed session ID is required");
  }
  if (!settlementType || !["PAYMENT", "DEDUCTED", "FOC"].includes(settlementType)) {
    throw new BadRequestError(
      "INVALID_SETTLEMENT_TYPE",
      "Settlement type must be PAYMENT, DEDUCTED, or FOC"
    );
  }

  const owed = await OwedPtSession.findOne({
    $or: [
      ...(Types.ObjectId.isValid(sessionId) ? [{ _id: new Types.ObjectId(sessionId) }] : []),
      ...(Types.ObjectId.isValid(sessionId) ? [{ attendanceRowId: new Types.ObjectId(sessionId) }] : []),
    ],
  });

  if (!owed) {
    throw new NotFoundError("OWED_SESSION_NOT_FOUND", "Owed PT session not found");
  }

  if (owed.status !== "PENDING") {
    throw new BadRequestError(
      "SESSION_ALREADY_SETTLED",
      `This session is already settled (${owed.status})`
    );
  }

  let branchLocationId: string | undefined;
  try {
    branchLocationId = resolveLocationIdForWrite(req);
  } catch {
    branchLocationId = undefined;
  }
  const locationToUse = branchLocationId || owed.locationId?.toString();
  const io = req.app.get("io");

  await runInTransaction(async (session) => {
    if (settlementType === "PAYMENT") {
      if (!paymentMethod) {
        throw new BadRequestError(
          "PAYMENT_METHOD_REQUIRED",
          "Payment method is required for payment settlement"
        );
      }

      const dropInPrice =
        amount !== undefined && amount !== null && String(amount) !== ""
          ? Number(amount)
          : owed.amount ||
            (await BookingsService.resolvePtDropInPrice(
              locationToUse,
              owed.coachId.toString()
            ));

      const parsedPaymentDate = paymentDate
        ? new Date(paymentDate).toISOString()
        : new Date().toISOString();

      const paymentNote = note
        ? `Settled owed PT with ${owed.coachName || "Coach"}; ${note}`
        : `Settled owed PT with ${owed.coachName || "Coach"}`;

      const payment = await PaymentsService.savePayment(
        owed.uid?.toString(),
        dropInPrice,
        paymentMethod,
        "DROPIN",
        session,
        undefined,
        undefined,
        undefined,
        undefined,
        parsedPaymentDate,
        paymentNote,
        owed.clientName,
        owed.phoneNumber,
        locationToUse,
        owed.coachId.toString(),
        owed.coachName
      );

      owed.status = "PAID";
      owed.settledPaymentId = new Types.ObjectId(String(payment._id));
      owed.settledAt = new Date();
      if ((req as any).user?._id) {
        owed.settledBy = new Types.ObjectId((req as any).user._id);
      }
      await owed.save({ session });

      await DailyAttendance.updateOne(
        { _id: owed.dailyAttendanceId, "ptAttendance._id": owed.attendanceRowId },
        { $set: { "ptAttendance.$.status": "SUCCESS" } },
        { session }
      );
    } else if (settlementType === "DEDUCTED") {
      if (!pkgId) {
        throw new BadRequestError(
          "PACKAGE_REQUIRED",
          "Package ID is required for deduction settlement"
        );
      }

      const targetPackage = await Package.findById(pkgId).session(session);
      if (!targetPackage) {
        throw new NotFoundError("PACKAGE_NOT_FOUND", "Package not found");
      }

      const isPtPackage =
        targetPackage.category === "PERSONAL_TRAINING" || Boolean(targetPackage.coachId);
      if (!isPtPackage || targetPackage.coachId?.toString() !== owed.coachId.toString()) {
        throw new BadRequestError(
          "COACH_MISMATCH",
          `Cannot deduct session: Package is not for Coach ${owed.coachName || "assigned to this session"}`
        );
      }

      let deducted = false;
      if (owed.uid) {
        const member = await Member.findOne({ uid: owed.uid }).session(session);
        const holding = (member?.packages ?? []).find(
          (p) =>
            p.pkgId.toString() === targetPackage._id.toString() &&
            p.status === "ACTIVE" &&
            p.remainingClasses > 0
        );
        if (holding) {
          holding.remainingClasses -= 1;
          (holding.adjustmentHistory ??= []).push({
            date: new Date(),
            attendanceDate: owed.attendanceDate,
            source: "ADMIN",
            type: "DEDUCT",
            amount: 1,
            className: targetPackage.name,
            reason: `Deducted for owed PT session attended on ${format(new Date(owed.attendanceDate), "dd-MM-yyyy")} with Coach ${owed.coachName || targetPackage.name}`,
          });
          if (holding.remainingClasses === 0) {
            holding.status = "COMPLETED";
          }
          await member?.save({ session });
          deducted = true;
        }
      }

      if (!deducted) {
        const nonUserPkg = await NonUserPackage.findOne({
          phoneNumber: owed.phoneNumber,
          pkgId: targetPackage._id,
          added: { $ne: true },
          remainingClasses: { $gt: 0 },
        }).session(session);

        if (nonUserPkg) {
          nonUserPkg.remainingClasses -= 1;
          await nonUserPkg.save({ session });
          deducted = true;
        }
      }

      if (!deducted) {
        throw new BadRequestError(
          "NO_REMAINING_SESSIONS",
          "No active sessions remaining on this package to deduct"
        );
      }

      owed.status = "DEDUCTED";
      owed.settledPackageId = targetPackage._id;
      owed.settledAt = new Date();
      if ((req as any).user?._id) {
        owed.settledBy = new Types.ObjectId((req as any).user._id);
      }
      await owed.save({ session });

      await DailyAttendance.updateOne(
        { _id: owed.dailyAttendanceId, "ptAttendance._id": owed.attendanceRowId },
        {
          $set: {
            "ptAttendance.$.status": "SUCCESS",
            "ptAttendance.$.pkgId": targetPackage._id,
          },
        },
        { session }
      );
    } else if (settlementType === "FOC") {
      owed.status = "FOC";
      owed.settledAt = new Date();
      if ((req as any).user?._id) {
        owed.settledBy = new Types.ObjectId((req as any).user._id);
      }
      await owed.save({ session });

      await DailyAttendance.updateOne(
        { _id: owed.dailyAttendanceId, "ptAttendance._id": owed.attendanceRowId },
        { $set: { "ptAttendance.$.status": "FOC" } },
        { session }
      );
    }
  });

  if (io) {
    io.emit("SUCCESS-SCAN");
  }

  new SuccessResponse("PT session settled successfully", owed).send(res);
});
