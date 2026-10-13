import crypto from "crypto";
import { Types } from "mongoose";
import { formatInTimeZone } from "date-fns-tz";
import Payment, { IPayment } from "../models/payment";
import Package from "../models/package";
import Coach from "../models/coach";
import User from "../models/user";
import logger from "../config/logger";
import { CAIRO_TZ } from "../utils/timezone";

export const DEFAULT_COACHERA_INTAKE_URL =
  "https://pmfieyesclymxcvhulor.supabase.co/functions/v1/mindspace-intake";

export interface CoacheraOrderPayload {
  order_id: string;
  coach_email: string;
  client: {
    name: string;
    email: string;
    phone: string;
  };
  duration_months: number;
  amount: number;
  currency: string;
  paid_at: string;
}

export interface CoacheraNotifyResult {
  success: boolean;
  status: "pending_signup" | "active" | "synced" | "failed" | "skipped";
  orderPayload?: CoacheraOrderPayload;
  responseStatus?: number;
  responseBody?: unknown;
  error?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks whether a package is an online package that should be synced to Coachera.
 */
export function isCoacheraOnlinePackage(
  pkg?: { name?: string; category?: string } | null
): boolean {
  if (!pkg?.name) return false;
  return /\bonline\b/i.test(pkg.name);
}

/**
 * Resolves package duration in months from package name or expiryPeriod days.
 */
export function resolveDurationMonths(pkg: {
  name?: string;
  expiryPeriod?: number;
}): number {
  if (pkg.name) {
    const match = pkg.name.match(/(\d+)\s*months?/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed > 0) return parsed;
    }
  }
  const days = pkg.expiryPeriod || 30;
  return Math.max(1, Math.round(days / 30));
}

/**
 * Formats Egyptian phone numbers to +20... international format expected by Coachera.
 */
export function formatInternationalPhone(phone?: string | null): string {
  if (!phone) return "";
  const trimmed = String(phone).trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (/^01\d{9}$/.test(digits)) {
    return `+2${digits}`;
  }
  if (/^201\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  return trimmed;
}

/**
 * Computes the HMAC-SHA256 timestamp and signature for Coachera requests.
 */
export function signCoacheraPayload(
  body: string,
  secret: string,
  timestamp?: string
): { ts: string; sig: string } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${body}`)
    .digest("hex");
  return { ts, sig };
}

/**
 * Resolves the coach's ID, name, and email from a Package document.
 */
export async function resolveCoachDetailsForPackage(pkg: {
  name?: string;
  coachId?: Types.ObjectId | string | { _id?: Types.ObjectId | string } | null;
}): Promise<{
  coachId?: Types.ObjectId;
  coachName?: string;
  coachEmail?: string;
}> {
  let coachDoc: any = null;

  const rawCoachId =
    pkg.coachId && typeof pkg.coachId === "object" && "_id" in pkg.coachId
      ? pkg.coachId._id
      : pkg.coachId;

  if (rawCoachId && Types.ObjectId.isValid(String(rawCoachId))) {
    coachDoc = await Coach.findById(rawCoachId).lean();
  }

  // Fallback: extract coach name from package name e.g. "1 month Online PT with Hana Abaza"
  if (!coachDoc && pkg.name) {
    const withMatch = pkg.name.match(/\bwith\s+(.+)$/i);
    if (withMatch) {
      const extractedName = withMatch[1].trim();
      coachDoc = await Coach.findOne({
        coachName: new RegExp(escapeRegex(extractedName), "i"),
      }).lean();
    }
  }

  let coachUser: any = null;
  if (coachDoc?.userId) {
    coachUser = await User.findById(coachDoc.userId)
      .select("name email phoneNumber")
      .lean();
  }

  if (!coachUser && coachDoc?.phoneNumber) {
    coachUser = await User.findOne({
      phoneNumber: coachDoc.phoneNumber.trim(),
    })
      .select("name email phoneNumber")
      .lean();
  }

  if (!coachUser && coachDoc?.coachName) {
    coachUser = await User.findOne({
      name: new RegExp(`^${escapeRegex(coachDoc.coachName.trim())}$`, "i"),
      role: { $in: ["coach", "managing_coach"] },
    })
      .select("name email phoneNumber")
      .lean();
  }

  const coachId = coachDoc?._id
    ? new Types.ObjectId(String(coachDoc._id))
    : undefined;
  const coachName = coachDoc?.coachName || coachUser?.name || undefined;
  const coachEmail = coachUser?.email
    ? String(coachUser.email).trim().toLowerCase()
    : undefined;

  return { coachId, coachName, coachEmail };
}

/**
 * Sends a package purchase notification to Coachera's mindspace-intake endpoint
 * and updates the Payment document with Coachera metadata & sync status.
 */
export async function notifyCoacheraOfPurchase(options: {
  payment: IPayment | ( Record<string, any> & { _id: Types.ObjectId | string } );
  pkg?: {
    _id?: Types.ObjectId | string;
    name?: string;
    category?: string;
    expiryPeriod?: number;
    coachId?: Types.ObjectId | string | null;
  } | null;
  user?: {
    _id?: Types.ObjectId | string;
    name?: string;
    email?: string;
    phoneNumber?: string;
  } | null;
  fallbackClient?: {
    name?: string;
    email?: string;
    phone?: string;
  };
}): Promise<CoacheraNotifyResult> {
  try {
    const paymentDoc = options.payment;
    let pkg = options.pkg;

    if (!pkg && paymentDoc.pkgId) {
      pkg = (await Package.findById(paymentDoc.pkgId).lean()) as any;
    }

    if (!isCoacheraOnlinePackage(pkg)) {
      return {
        success: false,
        status: "skipped",
        error: "Package is not an online Coachera package",
      };
    }

    // 1. Resolve Coach
    const { coachId, coachName, coachEmail } =
      await resolveCoachDetailsForPackage(pkg!);

    // 2. Resolve Client
    let user = options.user;
    if (!user && paymentDoc.uid) {
      user = (await User.findById(paymentDoc.uid)
        .select("name email phoneNumber")
        .lean()) as any;
    }

    const clientName =
      user?.name?.trim() ||
      options.fallbackClient?.name?.trim() ||
      paymentDoc.nonMemberName?.trim() ||
      "Client";
    const clientEmail = (
      user?.email ||
      options.fallbackClient?.email ||
      ""
    )
      .trim()
      .toLowerCase();
    const clientPhone = formatInternationalPhone(
      user?.phoneNumber ||
        options.fallbackClient?.phone ||
        paymentDoc.nonMemberPhone ||
        ""
    );

    const durationMonths = resolveDurationMonths(pkg!);
    const paymentDate =
      paymentDoc.paymentTime instanceof Date
        ? paymentDoc.paymentTime
        : paymentDoc.paymentTime
        ? new Date(paymentDoc.paymentTime)
        : new Date();
    const paidAt = formatInTimeZone(paymentDate, CAIRO_TZ, "yyyy-MM-dd");

    const orderId = String(paymentDoc.orderId || paymentDoc._id);

    const baseUpdate: Record<string, any> = {
      platform: "COACHERA",
      durationMonths,
      ...(coachId ? { coachId } : {}),
      ...(coachName ? { coachName } : {}),
      ...(coachEmail ? { coachEmail } : {}),
    };

    // Validate required fields for Coachera intake
    if (!coachEmail) {
      const errorMsg = `Coach email could not be resolved for package "${pkg?.name}"`;
      logger.warn(`Coachera notification skipped/failed: ${errorMsg}`, {
        paymentId: paymentDoc._id,
        coachName,
      });
      await Payment.findByIdAndUpdate(paymentDoc._id, {
        $set: {
          ...baseUpdate,
          coacheraStatus: "failed",
          coacheraError: errorMsg,
        },
      });
      return {
        success: false,
        status: "failed",
        error: errorMsg,
      };
    }

    if (!clientEmail) {
      const errorMsg = `Client email is missing for client "${clientName}"`;
      logger.warn(`Coachera notification failed: ${errorMsg}`, {
        paymentId: paymentDoc._id,
      });
      await Payment.findByIdAndUpdate(paymentDoc._id, {
        $set: {
          ...baseUpdate,
          coacheraStatus: "failed",
          coacheraError: errorMsg,
        },
      });
      return {
        success: false,
        status: "failed",
        error: errorMsg,
      };
    }

    const orderPayload: CoacheraOrderPayload = {
      order_id: orderId,
      coach_email: coachEmail,
      client: {
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
      },
      duration_months: durationMonths,
      amount: Number(paymentDoc.amount),
      currency: "EGP",
      paid_at: paidAt,
    };

    const secret = process.env.COACHERA_SECRET;
    if (!secret) {
      const errorMsg = "COACHERA_SECRET environment variable is not configured";
      logger.warn(`Coachera sync skipped: ${errorMsg}`, {
        paymentId: paymentDoc._id,
      });
      await Payment.findByIdAndUpdate(paymentDoc._id, {
        $set: {
          ...baseUpdate,
          coacheraStatus: "skipped",
          coacheraError: errorMsg,
        },
      });
      return {
        success: false,
        status: "skipped",
        orderPayload,
        error: errorMsg,
      };
    }

    const intakeUrl =
      process.env.COACHERA_INTAKE_URL || DEFAULT_COACHERA_INTAKE_URL;
    const body = JSON.stringify(orderPayload);
    const { ts, sig } = signCoacheraPayload(body, secret);

    logger.info("Sending online package purchase to Coachera", {
      paymentId: paymentDoc._id,
      orderId,
      coachEmail,
      clientEmail,
      durationMonths,
      amount: orderPayload.amount,
    });

    const response = await fetch(intakeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mindspace-timestamp": ts,
        "x-mindspace-signature": sig,
      },
      body,
    });

    const rawText = await response.text();
    let parsedBody: any = rawText;
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      // keep rawText
    }

    if (response.ok) {
      const resolvedStatus: CoacheraNotifyResult["status"] =
        parsedBody?.status === "pending_signup"
          ? "pending_signup"
          : parsedBody?.status === "active"
          ? "active"
          : "synced";

      await Payment.findByIdAndUpdate(paymentDoc._id, {
        $set: {
          ...baseUpdate,
          coacheraStatus: resolvedStatus,
          coacheraSyncedAt: new Date(),
          coacheraError: undefined,
        },
      });

      logger.info("Successfully notified Coachera of purchase", {
        paymentId: paymentDoc._id,
        orderId,
        coacheraStatus: resolvedStatus,
        response: parsedBody,
      });

      return {
        success: true,
        status: resolvedStatus,
        orderPayload,
        responseStatus: response.status,
        responseBody: parsedBody,
      };
    } else {
      const errorDetail =
        typeof parsedBody === "object" && parsedBody !== null
          ? JSON.stringify(parsedBody)
          : String(rawText || `HTTP ${response.status}`);

      await Payment.findByIdAndUpdate(paymentDoc._id, {
        $set: {
          ...baseUpdate,
          coacheraStatus: "failed",
          coacheraError: `HTTP ${response.status}: ${errorDetail}`,
        },
      });

      logger.error("Coachera intake endpoint returned error", {
        paymentId: paymentDoc._id,
        orderId,
        status: response.status,
        response: parsedBody,
      });

      return {
        success: false,
        status: "failed",
        orderPayload,
        responseStatus: response.status,
        responseBody: parsedBody,
        error: `HTTP ${response.status}: ${errorDetail}`,
      };
    }
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown error notifying Coachera";
    logger.error("Exception while notifying Coachera of purchase", {
      paymentId: options.payment?._id,
      error: errorMsg,
    });

    if (options.payment?._id) {
      await Payment.findByIdAndUpdate(options.payment._id, {
        $set: {
          platform: "COACHERA",
          coacheraStatus: "failed",
          coacheraError: errorMsg,
        },
      }).catch(() => {});
    }

    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }
}
