import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { AuthFailureError, InternalError } from "../core/ApiError";

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

export const verifyCoacheraSignature = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const secret = process.env.COACHERA_SECRET;
  if (!secret) {
    return next(
      new InternalError(
        "COACHERA_SECRET_NOT_CONFIGURED",
        "COACHERA_SECRET environment variable is not configured"
      )
    );
  }

  const tsHeader = req.headers["x-mindspace-timestamp"];
  const sigHeader = req.headers["x-mindspace-signature"];

  if (
    !tsHeader ||
    !sigHeader ||
    typeof tsHeader !== "string" ||
    typeof sigHeader !== "string"
  ) {
    return next(
      new AuthFailureError(
        "MISSING_COACHERA_HEADERS",
        "Missing x-mindspace-timestamp or x-mindspace-signature header"
      )
    );
  }

  const tsNumber = Number(tsHeader);
  if (!Number.isFinite(tsNumber) || tsNumber <= 0) {
    return next(
      new AuthFailureError(
        "INVALID_COACHERA_TIMESTAMP",
        "Invalid x-mindspace-timestamp header"
      )
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsNumber) > TIMESTAMP_TOLERANCE_SECONDS) {
    return next(
      new AuthFailureError(
        "EXPIRED_COACHERA_TIMESTAMP",
        "Request timestamp is outside the allowed 5-minute window"
      )
    );
  }

  const rawBody: string =
    typeof (req as any).rawBody === "string"
      ? (req as any).rawBody
      : JSON.stringify(req.body ?? {});

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${tsHeader}.${rawBody}`)
    .digest("hex");

  const providedBuf = Buffer.from(sigHeader, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return next(
      new AuthFailureError(
        "INVALID_COACHERA_SIGNATURE",
        "Invalid x-mindspace-signature"
      )
    );
  }

  next();
};
