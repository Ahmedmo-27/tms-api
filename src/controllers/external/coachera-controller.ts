import { Request, Response } from "express";
import asyncHandler from "../../utils/asyncHandler";
import { SuccessResponse } from "../../core/ApiResponse";
import { BadRequestError } from "../../core/ApiError";
import Payment from "../../models/payment";
import User from "../../models/user";
import Coach from "../../models/coach";
import Location from "../../models/location";
import { Types } from "mongoose";
import logger from "../../config/logger";

interface CoacheraOrderPayload {
  order_id: string;
  coach_email: string;
  client?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  duration_months?: number;
  amount: number;
  currency?: string;
  paid_at?: string | Date;
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
    }: CoacheraOrderPayload = req.body;

    if (!order_id || typeof order_id !== "string") {
      throw new BadRequestError("MISSING_ORDER_ID", "order_id is required");
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      throw new BadRequestError("INVALID_AMOUNT", "Valid amount is required");
    }

    if (!coach_email || typeof coach_email !== "string") {
      throw new BadRequestError(
        "MISSING_COACH_EMAIL",
        "coach_email is required"
      );
    }

    // Idempotency: return existing payment if order was already processed
    const existingPayment = await Payment.findOne({ orderId: order_id.trim() });
    if (existingPayment) {
      logger.info(
        `Coachera order ${order_id} already processed. Returning existing record.`
      );
      new SuccessResponse("Order already processed", existingPayment).send(res);
      return;
    }

    // 1. Resolve Coach by coach_email
    const normalizedCoachEmail = coach_email.trim().toLowerCase();
    let coachId: Types.ObjectId | undefined;
    let coachName = normalizedCoachEmail;

    const coachUser = await User.findOne({
      email: new RegExp(`^${normalizedCoachEmail}$`, "i"),
    });

    if (coachUser) {
      coachName = coachUser.name;
      const coachDoc = await Coach.findOne({ userId: coachUser._id });
      if (coachDoc) {
        coachId = coachDoc._id as Types.ObjectId;
        if (coachDoc.coachName) {
          coachName = coachDoc.coachName;
        }
      }
    } else {
      // Check if coach document matches name prefix before @
      const coachEmailPrefix = normalizedCoachEmail.split("@")[0].replace(/[._-]/g, " ");
      const coachByName = await Coach.findOne({
        coachName: new RegExp(coachEmailPrefix, "i"),
      });
      if (coachByName) {
        coachId = coachByName._id as Types.ObjectId;
        coachName = coachByName.coachName;
      }
    }

    // 2. Resolve Client / Member if exists
    let linkedUserId: Types.ObjectId | undefined;
    const clientEmail = client?.email?.trim();
    const rawClientPhone = client?.phone?.toString().trim();
    const userSearchOr: Array<Record<string, any>> = [];

    if (clientEmail) {
      userSearchOr.push({ email: new RegExp(`^${clientEmail}$`, "i") });
    }
    if (rawClientPhone) {
      // Normalize Egyptian phone variations (+201..., 01...)
      const cleanedPhone = rawClientPhone
        .replace(/^\+20?/, "0")
        .replace(/\D/g, "");
      if (cleanedPhone) {
        userSearchOr.push({ phoneNumber: cleanedPhone });
      }
    }

    if (userSearchOr.length > 0) {
      const matchedUser = await User.findOne({ $or: userSearchOr });
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
    const months = duration_months ? Number(duration_months) : 1;
    const clientName = client?.name?.trim() || "Online Client";
    const note = `Coachera Online Class (${months} mo) · Coach: ${coachName} · Client: ${clientName}${
      clientEmail ? ` (${clientEmail})` : ""
    }`;

    // 5. Parse payment date
    let paymentDate = new Date();
    if (paid_at) {
      const parsed = new Date(paid_at);
      if (!isNaN(parsed.getTime())) {
        paymentDate = parsed;
      }
    }

    // 6. Create and persist Payment
    const payment = new Payment({
      uid: linkedUserId,
      nonMemberName: clientName,
      nonMemberPhone: client?.phone ? String(client.phone).trim() : "",
      amount: Number(amount),
      paymentMethod: "COACHERA",
      paymentTime: paymentDate,
      orderId: order_id.trim(),
      purpose: "ONLINE_CLASS",
      note,
      coachId,
      coachEmail: normalizedCoachEmail,
      coachName,
      durationMonths: months,
      platform: "COACHERA",
      locationId,
      isRefunded: false,
    });

    await payment.save();

    logger.info(`Coachera payment recorded successfully for order ${order_id}`, {
      paymentId: payment._id,
      amount: payment.amount,
      coach: coachName,
      client: clientName,
    });

    new SuccessResponse("Coachera payment recorded successfully", payment).send(
      res
    );
  }
);
