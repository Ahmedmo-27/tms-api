import { Request, Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { ChallengeService } from "../../services/challenge-service";
import { BadRequestError } from "../../core/ApiError";
import Member from "../../models/member";
import { SuccessResponse } from "../../core/ApiResponse";
import asyncHandler from "../../utils/asyncHandler";

// ============= GET USER RECORD =============

export const getMemberChallengeRecord = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const record = await ChallengeService.getUserRecord(uid);
  new SuccessResponse("Record Found!", record).send(res);
});
// ============= SUBSCRIBE TO CHALLENGE =============
export const subToChallenge = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const merchantReferenceId = req.body.merchantReferenceId;
  if (!merchantReferenceId)
    throw new BadRequestError(
      "INVALID_INPUT",
      "merchantReferenceId is required",
    );
  const member = await Member.findOne({ uid });
  await ChallengeService.subToChallenge(uid, merchantReferenceId, !!member);
  new SuccessResponse("Subscribed to challenge successfully !").send(res);
});

// ============= INITIALIZE USER RECORD =============

export const initMemberChallengeRecord = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const record = await ChallengeService.initUserRecord(uid);
  new SuccessResponse(
    "Challenge record initialized successfully!",
    record,
  ).send(res);
});

export const initRunChallengeRecord = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { runSubscription } = req.body;

  if (!runSubscription || !["5km", "10km"].includes(runSubscription))
    throw new BadRequestError(
      "INVALID_INPUT",
      "Run subscription must be '5km' or '10km'",
    );

  const record = await ChallengeService.initRunChallenge(uid, runSubscription);
  new SuccessResponse("Run record initialized successfully!", record).send(res);
});

export const initWorkoutChallenge = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;

  const record = await ChallengeService.initWorkoutChallenge(uid);
  new SuccessResponse("Workout record initialized successfully!", record).send(
    res,
  );
});

// ============= RUN CHALLENGE =============

export const getRunDetails = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  let runDetails = {
    challenges: [
      {
        id: "5km",
        title: "5KM Challenge",
        duration: {
          totalDays: 30,
          runsPerWeek: 3,
        },
        goal: "Run a continuous 5 km by the end of Ramadan",
        weeklyStructure: [
          {
            type: "intervals",
            title: "Intervals Run",
            description: "Build confidence & aerobic base",
          },
          {
            type: "easy",
            title: "Easy Short Run",
            description: "Conversational, relaxed",
          },
          {
            type: "long",
            title: "Long Run",
            description: "Slow, patient progress",
          },
        ],
        rules: ["Walking is allowed. Always."],
        weeks: [
          {
            weekNumber: 1,
            sessions: {
              intervals: {
                structure: "1 min run / 2 min walk × 8 rounds",
              },
              easy: {
                duration: "15 minutes easy",
              },
              long: {
                duration: "20 minutes total",
              },
            },
          },
          {
            weekNumber: 2,
            sessions: {
              intervals: {
                structure: "2 min run / 2 min walk × 7 rounds",
              },
              easy: {
                duration: "20 minutes",
              },
              long: {
                duration: "25–30 minutes",
              },
            },
          },
          {
            weekNumber: 3,
            sessions: {
              intervals: {
                structure: "3 min run / 1.5 min walk × 6 rounds",
              },
              easy: {
                duration: "25 minutes",
              },
              long: {
                duration: "30–35 minutes",
              },
            },
          },
          {
            weekNumber: 4,
            sessions: {
              intervals: {
                structure: "4 min run / 1 min walk × 5–6 rounds",
              },
              easy: {
                duration: "30 minutes",
              },
              long: {
                title: "Challenge Run",
                target: "5 km",
                note: "Walk breaks allowed, goal is completion",
              },
            },
          },
        ],
      },
      {
        id: "10km",
        title: "10KM Challenge",
        duration: {
          totalDays: 30,
          runsPerWeek: 3,
          optionalRunsPerWeek: 1,
        },
        goal: "Build endurance and complete a strong 10 km run",
        weeklyStructure: [
          {
            type: "intervals",
            title: "Intervals",
            description: "Quality & speed",
          },
          {
            type: "recovery",
            title: "Recovery Run",
            description: "Easy, relaxed",
          },
          {
            type: "long",
            title: "Long Run",
            description: "Endurance build",
          },
          {
            type: "tempo",
            title: "Optional Tempo Run",
            description:
              "Steady effort that is comfortably hard. Not a sprint. Not too easy.",
            optional: true,
          },
        ],
        weeks: [
          {
            weekNumber: 1,
            sessions: {
              intervals: {
                structure: "400 m repeats × 5",
              },
              recovery: {
                duration: "20 minutes easy",
              },
              long: {
                distance: "6 km",
              },
              tempo: {
                duration: "12 minutes",
                optional: true,
              },
            },
          },
          {
            weekNumber: 2,
            sessions: {
              intervals: {
                structure: "600 m repeats × 5",
              },
              recovery: {
                duration: "25 minutes easy",
              },
              long: {
                distance: "7 km",
              },
              tempo: {
                duration: "15 minutes",
                optional: true,
              },
            },
          },
          {
            weekNumber: 3,
            sessions: {
              intervals: {
                structure: "800 m repeats × 6",
              },
              recovery: {
                duration: "30 minutes easy",
              },
              long: {
                distance: "8.5 km",
              },
              tempo: {
                duration: "15 minutes",
                optional: true,
              },
            },
          },
          {
            weekNumber: 4,
            sessions: {
              intervals: {
                structure: "400 m repeats × 5",
              },
              recovery: {
                duration: "25 minutes easy",
              },
              long: {
                title: "Peak Long Run",
                distance: "10 km",
              },
              tempo: {
                duration: "12 minutes",
                optional: true,
              },
            },
          },
        ],
      },
    ],
  };
  new SuccessResponse("Run updated successfully!", runDetails).send(res);
});

export const updateRun = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { week, runType, distance, pace, duration, route } = req.body;

  if (
    !week ||
    !runType ||
    distance === undefined ||
    pace === undefined ||
    duration === undefined ||
    route === undefined
  )
    throw new BadRequestError(
      "INVALID_INPUT",
      "Week, runType, distance, pace, duration, and route are required",
    );

  const record = await ChallengeService.updateRun(uid, week, runType, {
    distance,
    pace,
    duration,
    route,
  });
  new SuccessResponse("Run updated successfully!", record).send(res);
});

export const resetRun = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { week, runType } = req.body;

  if (!week || !runType)
    throw new BadRequestError("INVALID_INPUT", "Week and runType are required");

  const record = await ChallengeService.resetRun(uid, week, runType);
  new SuccessResponse("Run reset successfully!", record).send(res);
});

// ============= MEDITATION =============

export const updateMeditation = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day, progress } = req.body;

  if (!day || progress === undefined)
    throw new BadRequestError("INVALID_INPUT", "Day and progress are required");

  const record = await ChallengeService.updateMeditation(uid, day, progress);
  new SuccessResponse("Meditation updated successfully!", record).send(res);
});

export const resetMeditation = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day } = req.body;

  if (!day) throw new BadRequestError("INVALID_INPUT", "Day is required");

  const record = await ChallengeService.resetMeditation(uid, day);
  new SuccessResponse("Meditation reset successfully!", record).send(res);
});

// ============= WATER INTAKE =============

export const updateWaterIntake = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day, progress } = req.body;

  if (!day || progress === undefined)
    throw new BadRequestError("INVALID_INPUT", "Day and progress are required");

  const record = await ChallengeService.updateWaterIntake(uid, day, progress);
  new SuccessResponse("Water intake updated successfully!", record).send(res);
});

export const resetWaterIntake = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day } = req.body;

  if (!day) throw new BadRequestError("INVALID_INPUT", "Day is required");

  const record = await ChallengeService.resetWaterIntake(uid, day);
  new SuccessResponse("Water intake reset successfully!", record).send(res);
});

// ============= CHARITY =============

// Add a new charity place
export const addCharityPlace = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, description, locationLink } = req.body;

    if (!name || !description || !locationLink)
      throw new BadRequestError("INVALID_INPUT", "All fields are required");

    const place = await ChallengeService.addPlace({
      name,
      description,
      locationLink,
    });
    new SuccessResponse("Charity place added successfully!", place).send(res);
  },
);

// Get all charity places
export const getAllCharityPlaces = asyncHandler(
  async (req: Request, res: Response) => {
    const places = await ChallengeService.getAllPlaces();
    new SuccessResponse("Charity places fetched successfully!", places).send(
      res,
    );
  },
);

export const updateCharity = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day, completed } = req.body;

  if (!day || completed === undefined)
    throw new BadRequestError(
      "INVALID_INPUT",
      "Day and completed are required",
    );

  const record = await ChallengeService.updateCharity(uid, day, completed);
  new SuccessResponse("Charity updated successfully!", record).send(res);
});

export const resetCharity = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day } = req.body;

  if (!day) throw new BadRequestError("INVALID_INPUT", "Day is required");

  const record = await ChallengeService.resetCharity(uid, day);
  new SuccessResponse("Charity reset successfully!", record).send(res);
});

// ============= WORKOUT CHALLENGE =============

export const updateWorkoutDay = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;

  const { week, dayNumber, completed } = req.body;

  // Controller-level validation (basic shape only)
  if (
    typeof week !== "number" ||
    typeof dayNumber !== "number" ||
    typeof completed !== "boolean"
  ) {
    throw new BadRequestError(
      "INVALID_INPUT",
      "week (number), dayNumber (number), and completed (boolean) are required",
    );
  }

  const record = await ChallengeService.updateWorkoutDay(
    uid,
    week,
    dayNumber,
    completed,
  );

  new SuccessResponse("Workout day updated successfully!", record).send(res);
});

export const resetWorkoutDay = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;

  const { week, dayNumber } = req.body;

  if (typeof week !== "number" || typeof dayNumber !== "number") {
    throw new BadRequestError(
      "INVALID_INPUT",
      "week (number) and dayNumber (number) are required",
    );
  }

  const record = await ChallengeService.resetWorkoutDay(uid, week, dayNumber);

  new SuccessResponse("Workout day reset successfully!", record).send(res);
});

// ============= READS =============

export const updateReads = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day, completed } = req.body;

  if (!day || completed === undefined)
    throw new BadRequestError(
      "INVALID_INPUT",
      "Day and completed are required",
    );

  const record = await ChallengeService.updateReads(uid, day, completed);
  new SuccessResponse("Reads updated successfully!", record).send(res);
});

export const resetReads = asyncHandler(async function (
  req: Request,
  res: Response,
): Promise<void> {
  const authReq = req as AuthRequest;
  const uid = authReq.user._id as string;
  const { day } = req.body;

  if (!day) throw new BadRequestError("INVALID_INPUT", "Day is required");

  const record = await ChallengeService.resetReads(uid, day);
  new SuccessResponse("Reads reset successfully!", record).send(res);
});
