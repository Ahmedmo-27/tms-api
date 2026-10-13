import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { BadRequestError } from "../../core/ApiError";
import { SuccessResponse } from "../../core/ApiResponse";
import Payment from "../../models/payment";
import User from "../../models/user";
import Coach from "../../models/coach";

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

export const receiveCoacheraIntake = asyncHandler(
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
        : undefined;
    if (
      numericDuration !== undefined &&
      (!Number.isFinite(numericDuration) || numericDuration <= 0)
    ) {
      throw new BadRequestError(
        "INVALID_DURATION",
        "duration_months must be a positive number"
      );
    }

    const paymentTime = paid_at ? parsePaidAtDate(String(paid_at)) : new Date();
    const normalizedCoachEmail = coach_email.trim().toLowerCase();

    // 1. Resolve Coach by email
    const coachUser = await User.findOne({
      email: new RegExp(`^${escapeRegex(normalizedCoachEmail)}$`, "i"),
    })
      .select("_id name email")
      .lean();

    let coachDoc: any = null;
    if (coachUser?._id) {
      coachDoc = await Coach.findOne({ userId: coachUser._id }).lean();
    }
    if (!coachDoc && coachUser?.name) {
      coachDoc = await Coach.findOne({
        coachName: new RegExp(`^${escapeRegex(coachUser.name.trim())}$`, "i"),
      }).lean();
    }

    const resolvedCoachName =
      coachDoc?.coachName || coachUser?.name || normalizedCoachEmail;

    // 2. Resolve Client (Member) by email or phone
    let clientUser: any = null;
    const clientEmail =
      typeof client.email === "string" ? client.email.trim().toLowerCase() : "";
    const clientPhone =
      typeof client.phone === "string" ? client.phone.trim() : "";
    const clientName = String(client.name).trim();

    if (clientEmail) {
      clientUser = await User.findOne({
        email: new RegExp(`^${escapeRegex(clientEmail)}$`, "i"),
      })
        .select("_id name email phoneNumber")
        .lean();
    }

    if (!clientUser && clientPhone) {
      const normalizedDigits = clientPhone.replace(/\D/g, "");
      const localVariant = normalizedDigits.startsWith("20")
        ? `0${normalizedDigits.slice(2)}`
        : normalizedDigits;
      clientUser = await User.findOne({
        $or: [
          { phoneNumber: clientPhone },
          ...(localVariant ? [{ phoneNumber: localVariant }] : []),
        ],
      })
        .select("_id name email phoneNumber")
        .lean();
    }

    const durationLabel = numericDuration
      ? `${numericDuration} Month${numericDuration > 1 ? "s" : ""} Online Class`
      : "Online Class";
    const note = `Coachera ${durationLabel} — Coach: ${resolvedCoachName} (${normalizedCoachEmail}) [Order #${order_id.trim()}]`;

    const paymentUpdate: Record<string, any> = {
      orderId: order_id.trim(),
      uid: clientUser?._id ?? undefined,
      nonMemberName: clientName,
      nonMemberPhone: clientPhone || clientUser?.phoneNumber || undefined,
      amount: numericAmount,
      paymentMethod: "COACHERA",
      paymentTime,
      purpose: "ONLINE_CLASS",
      note,
      coachId: coachDoc?._id ?? undefined,
      coachEmail: normalizedCoachEmail,
      coachName: resolvedCoachName,
      durationMonths: numericDuration,
      platform: "COACHERA",
      coacheraStatus: "synced",
      coacheraSyncedAt: new Date(),
      currency: typeof currency === "string" ? currency.toUpperCase() : "EGP",
    };

    const payment = await Payment.findOneAndUpdate(
      { orderId: order_id.trim() },
      { $set: paymentUpdate },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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
