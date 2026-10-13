import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { BadRequestError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import Payment from "../../models/payment";
import User from "../../models/user";
import Coach from "../../models/coach";
import Location from "../../models/location";
import { Types } from "mongoose";
import logger from "../../config/logger";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePaidAtDate(paidAt: string): Date {
  const trimmed = paidAt.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T12:00:00+02:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new BadRequestError(
      "INVALID_PAID_AT",
      "paid_at must be a valid ISO date string"
    );
  }
  return parsed;
}

export const handleCoacheraIntake = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      order_id,
      coach_email,
      client,
      duration_months,
      amount,
      currency,
      paid_at,
    } = req.body ?? {};

    if (!order_id || typeof order_id !== "string" || !order_id.trim()) {
      throw new BadRequestError("INVALID_ORDER_ID", "order_id is required");
    }

    if (!coach_email || typeof coach_email !== "string" || !coach_email.trim()) {
      throw new BadRequestError("INVALID_COACH_EMAIL", "coach_email is required");
    }

    if (!client || typeof client !== "object" || !client.name) {
      throw new BadRequestError(
        "INVALID_CLIENT",
        "client object with name is required"
      );
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new BadRequestError(
        "INVALID_AMOUNT",
        "amount must be a positive number"
      );
    }

    const numericDuration =
      duration_months !== undefined && duration_months !== null
        ? Number(duration_months)
        : 1;
    if (
      numericDuration !== undefined &&
      (!Number.isFinite(numericDuration) || numericDuration <= 0)
    ) {
      throw new BadRequestError(
        "INVALID_DURATION",
        "duration_months must be a positive number"
      );
    }

    const paymentTime = paid_at
      ? parsePaidAtDate(String(paid_at))
      : new Date();
    const normalizedCoachEmail = coach_email.trim().toLowerCase();

    // 1. Resolve Coach by email
    const coachUser = await User.findOne({
      email: new RegExp(`^${escapeRegex(normalizedCoachEmail)}$`, "i"),
    })
      .select("_id name email")
      .lean();

    let coachDoc: any = null;
    let coachId: Types.ObjectId | undefined;
    let coachName: string = normalizedCoachEmail;

    if (coachUser?._id) {
      coachName = coachUser.name;
      coachDoc = await Coach.findOne({ userId: coachUser._id }).lean();
      if (coachDoc) {
        coachId = coachDoc._id as Types.ObjectId;
        if (coachDoc.coachName) {
          coachName = coachDoc.coachName;
        }
      }
    } else {
      // Check if coach document matches name prefix before @
      const coachEmailPrefix = normalizedCoachEmail
        .split("@")[0]
        .replace(/[._-]/g, " ");
      coachDoc = await Coach.findOne({
        coachName: new RegExp(escapeRegex(coachEmailPrefix), "i"),
      }).lean();
      if (coachDoc) {
        coachId = coachDoc._id as Types.ObjectId;
        coachName = coachDoc.coachName;
      }
    }

    // 2. Resolve Client (Member) by email or phone
    let linkedUserId: Types.ObjectId | undefined;
    const clientEmail =
      typeof client.email === "string" ? client.email.trim().toLowerCase() : "";
    const rawClientPhone =
      typeof client.phone === "string" ? client.phone.trim() : "";
    const clientName = String(client.name).trim();

    const userSearchOr: Array<Record<string, any>> = [];
    if (clientEmail) {
      userSearchOr.push({
        email: new RegExp(`^${escapeRegex(clientEmail)}$`, "i"),
      });
    }
    if (rawClientPhone) {
      const cleanedPhone = rawClientPhone
        .replace(/^\+20?/, "0")
        .replace(/\D/g, "");
      if (cleanedPhone) {
        userSearchOr.push({ phoneNumber: cleanedPhone });
      }
      userSearchOr.push({ phoneNumber: rawClientPhone });
    }

    if (userSearchOr.length > 0) {
      const matchedUser = await User.findOne({ $or: userSearchOr }).select("_id phoneNumber");
      if (matchedUser) {
        linkedUserId = matchedUser._id as Types.ObjectId;
      }
    }

    // 3. Resolve location: link to virtual "Online" location if present
    const onlineLocation = await Location.findOne({
      branchName: /online|coachera/i,
    });
    const locationId = onlineLocation?._id as Types.ObjectId | undefined;

    // 4. Construct descriptive note
    const durationLabel = numericDuration
      ? `${numericDuration} Month${numericDuration > 1 ? "s" : ""} Online Class`
      : "Online Class";
    const note = `Coachera ${durationLabel} — Coach: ${coachName} (${normalizedCoachEmail}) [Order #${order_id.trim()}]`;

    // 5. Upsert Payment for idempotency
    const paymentUpdate: Record<string, any> = {
      orderId: order_id.trim(),
      uid: linkedUserId,
      nonMemberName: clientName,
      nonMemberPhone: rawClientPhone || undefined,
      amount: numericAmount,
      paymentMethod: "COACHERA",
      paymentTime,
      purpose: "ONLINE_CLASS",
      note,
      coachId,
      coachEmail: normalizedCoachEmail,
      coachName,
      durationMonths: numericDuration,
      platform: "COACHERA",
      locationId,
      coacheraStatus: "synced",
      coacheraSyncedAt: new Date(),
      currency: typeof currency === "string" ? currency.toUpperCase() : "EGP",
      isRefunded: false,
    };

    const payment = await Payment.findOneAndUpdate(
      { orderId: order_id.trim() },
      { $set: paymentUpdate },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info(`Coachera payment recorded successfully for order ${order_id}`, {
      paymentId: payment._id,
      amount: payment.amount,
      coach: coachName,
      client: clientName,
    });

    new SuccessResponse("Coachera payment recorded successfully", {
      paymentId: payment._id,
      orderId: payment.orderId,
      coachName: payment.coachName,
      coachEmail: payment.coachEmail,
      amount: payment.amount,
      paymentTime: payment.paymentTime,
    }).send(res);
  }
);

export const receiveCoacheraIntake = handleCoacheraIntake;
