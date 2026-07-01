import { BadRequestError } from "../core/ApiError";

export function normalizeOpenGymPackageFields(body: {
  category: string;
  expiryPeriod?: number;
  numberOfSessions?: number;
  opensClasses?: unknown[];
}): { expiryPeriod: number; numberOfSessions: number } {
  if (body.category !== "OPEN_GYM") {
    if (!body.expiryPeriod)
      throw new BadRequestError("INVALID_REQUEST", "Invalid request");
    return {
      expiryPeriod: body.expiryPeriod,
      numberOfSessions: body.numberOfSessions ?? 1000,
    };
  }

  if (!body.expiryPeriod || body.expiryPeriod < 1) {
    throw new BadRequestError(
      "INVALID_OPEN_GYM_DURATION",
      "Open gym packages require a positive expiryPeriod (duration in days)",
    );
  }

  const hasClasses =
    Array.isArray(body.opensClasses) && body.opensClasses.length > 0;

  if (hasClasses) {
    if (!body.numberOfSessions || body.numberOfSessions < 1) {
      throw new BadRequestError(
        "OPEN_GYM_SESSIONS_REQUIRED",
        "Combo packages with classes require numberOfSessions",
      );
    }
    return {
      expiryPeriod: body.expiryPeriod,
      numberOfSessions: body.numberOfSessions,
    };
  }

  return {
    expiryPeriod: body.expiryPeriod,
    numberOfSessions: body.numberOfSessions ?? 10000,
  };
}
