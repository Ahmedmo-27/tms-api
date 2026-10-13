import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { AuthFailureError, InternalError } from "../core/ApiError";

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

export function verifyCoacheraSignature(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const secret = process.env.COACHERA_SECRET;
  if (!secret) {
    throw new InternalError(
      "COACHERA_SECRET_NOT_CONFIGURED",
      "COACHERA_SECRET environment variable is not configured"
    );
  }

  const ts = (req.headers["x-mindspace-timestamp"] ?? req.headers["x-coachera-timestamp"]) as
    | string
    | undefined;
  const sig = (req.headers["x-mindspace-signature"] ?? req.headers["x-coachera-signature"]) as
    | string
    | undefined;

  if (!ts || typeof ts !== "string" || !sig || typeof sig !== "string") {
    throw new AuthFailureError(
      "MISSING_SIGNATURE_HEADERS",
      "Missing x-mindspace-timestamp or x-mindspace-signature headers"
    );
  }

  const timestampNum = parseInt(ts, 10);
  if (isNaN(timestampNum) || timestampNum <= 0) {
    throw new AuthFailureError(
      "INVALID_TIMESTAMP_FORMAT",
      "Invalid timestamp format in x-mindspace-timestamp header"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > MAX_TIMESTAMP_AGE_SECONDS) {
    throw new AuthFailureError(
      "TIMESTAMP_EXPIRED",
      "Webhook timestamp has expired or is too far in the future"
    );
  }

  // Obtain raw body string
  const rawBody: string =
    typeof (req as any).rawBody === "string"
      ? (req as any).rawBody
      : JSON.stringify(req.body ?? {});

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  const providedBuf = Buffer.from(sig.trim(), "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new AuthFailureError(
      "INVALID_SIGNATURE",
      "Webhook signature verification failed"
    );
  }

  next();
}
