import { runInTransaction } from "../utils/transaction";
import { BadRequestError, NotFoundError } from "../core/ApiError";
import ChallengeRecord from "../models/challengeRecord";
import Member from "../models/member";
import { IChallengeRecord } from "../models/challengeRecord";
import { ClientSession } from "mongoose";
import { CharityPlace, ICharityPlace } from "../models/charityPlace";
import logger from "../config/logger";
import User from "../models/user";
import Package from "../models/package";
import { SubscriptionsService } from "./subscriptions-service";
import { PaymentsService } from "./payments-service";

export class ChallengeService {
  // ============= SUBSCRIBE TO PACKAGE =============
  static async subToChallenge(
    uid: string,
    merchantReferenceId: string,
    isMember: boolean,
  ): Promise<void> {
    if (isMember) {
      const pkg = await Package.findOne({ name: "WHOLE-E Ramadan" });
      if (!pkg)
        throw new NotFoundError("PACKAGE_NOT_FOUND", "Package is not found!");
      await SubscriptionsService.subscribeToPackage(
        uid,
        pkg._id.toString(),
        new Date().toString(),
        "APP",
        merchantReferenceId,
      );
    } else {
      const orderId = await PaymentsService.checkPayment(
        merchantReferenceId,
        500,
      );
      await runInTransaction(async (session: ClientSession) => {
        PaymentsService.savePayment(
          uid,
          500,
          "APP",
          "PACKAGE",
          session,
          orderId,
          merchantReferenceId,
          undefined,
          undefined,
          new Date().toString(),
        );
        const user = await User.findOne({ _id: uid }).session(session);
        if (!user) throw new NotFoundError("USER_NOT_FOUND", "User not found");
        user.hasRamadanPackage = true;
        await user.save({ session });
      });
    }
  }

  // ============= INITIALIZATION =============

  static async initUserRecord(uid: string): Promise<IChallengeRecord | null> {
    const user = await User.findOne({ _id: uid });
    if (!user)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        "Invalid UID or member not found",
      );
    await runInTransaction(async (session: ClientSession) => {
      user.hasRamadanPackage = true;
      await user!.save({ session });
      return await ChallengeRecord.initRecord(uid, session);
    });
    return null;
  }

  static async initRunChallenge(
    uid: string,
    runSubscription: "5km" | "10km",
  ): Promise<IChallengeRecord | null> {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        "Invalid UID or member not found",
      );
    await runInTransaction(async (session: ClientSession) => {
      return await ChallengeRecord.initRun(uid, runSubscription, session);
    });
    return null;
  }

  static async initWorkoutChallenge(
    uid: string,
  ): Promise<IChallengeRecord | null> {
    const member = await Member.findOne({ uid });
    if (!member)
      throw new NotFoundError(
        "MEMBER_NOT_FOUND",
        "Invalid UID or member not found",
      );

    let record: IChallengeRecord | null = null;

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.initWorkout(uid, session);
    });

    return record;
  }

  static async getUserRecord(uid: string): Promise<IChallengeRecord> {
    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );
    logger.info("Fetched Challenge Record: ", record);
    return record;
  }

  // ============= RUN CHALLENGE =============

  static async updateRun(
    uid: string,
    week: number,
    runType: "intervals" | "easyRun" | "longRun",
    data: { distance: number; pace: number; duration: number; route: string },
  ): Promise<IChallengeRecord> {
    // Validation
    if (week < 1 || week > 4)
      throw new BadRequestError("INVALID_INPUT", "Week must be 1 to 4");
    if (!["intervals", "easyRun", "longRun"].includes(runType))
      throw new BadRequestError("INVALID_INPUT", "Invalid run type");
    if (data.distance < 0 || data.pace < 0 || data.duration < 0)
      throw new BadRequestError(
        "INVALID_INPUT",
        "Distance, pace, and duration must be non-negative",
      );

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateRun(
        uid,
        week,
        runType,
        data,
        session,
      );
    });
    return record;
  }

  static async resetRun(
    uid: string,
    week: number,
    runType: "intervals" | "easyRun" | "longRun",
  ): Promise<IChallengeRecord> {
    // Validation
    if (week < 1 || week > 4)
      throw new BadRequestError("INVALID_INPUT", "Week must be 1 to 4");
    if (!["intervals", "easyRun", "longRun"].includes(runType))
      throw new BadRequestError("INVALID_INPUT", "Invalid run type");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetRun(uid, week, runType, session);
    });
    return record;
  }

  // ============= MEDITATION =============

  static async updateMeditation(
    uid: string,
    day: number,
    progress: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");
    if (progress < 0 || progress > 100)
      throw new BadRequestError("INVALID_INPUT", "Progress must be 0 to 100");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateMeditation(
        uid,
        day,
        progress,
        session,
      );
    });
    return record;
  }

  static async resetMeditation(
    uid: string,
    day: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetMeditation(uid, day, session);
    });
    return record;
  }

  // ============= WATER INTAKE =============

  static async updateWaterIntake(
    uid: string,
    day: number,
    progress: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");
    if (progress < 0 || progress > 100)
      throw new BadRequestError("INVALID_INPUT", "Progress must be 0 to 100");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateWaterIntake(
        uid,
        day,
        progress,
        session,
      );
    });
    return record;
  }

  static async resetWaterIntake(
    uid: string,
    day: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetWaterIntake(uid, day, session);
    });
    return record;
  }

  // ============= CHARITY =============

  static async addPlace(place: ICharityPlace): Promise<ICharityPlace> {
    return await CharityPlace.create(place);
  }

  // Fetch all charity places
  static async getAllPlaces(): Promise<ICharityPlace[]> {
    return await CharityPlace.find().sort({ name: 1 }); // sorted by name
  }

  static async updateCharity(
    uid: string,
    day: number,
    completed: boolean,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateCharity(
        uid,
        day,
        completed,
        session,
      );
    });
    return record;
  }

  static async resetCharity(
    uid: string,
    day: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetCharity(uid, day, session);
    });
    return record;
  }

  // ============= WORKOUT CHALLENGE =============

  static async updateWorkoutDay(
    uid: string,
    week: number,
    dayNumber: number,
    completed: boolean,
    scid?: string,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (week < 1 || week > 4)
      throw new BadRequestError("INVALID_INPUT", "Week must be 1 to 4");

    if (dayNumber < 1 || dayNumber > 4)
      throw new BadRequestError("INVALID_INPUT", "Workout day must be 1 to 4");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });

    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateWorkoutDay(
        uid,
        week,
        dayNumber,
        completed,
        scid,
        session,
      );
    });

    return record;
  }

  static async resetWorkoutDay(
    uid: string,
    week: number,
    dayNumber: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (week < 1 || week > 4)
      throw new BadRequestError("INVALID_INPUT", "Week must be 1 to 4");

    if (dayNumber < 1 || dayNumber > 4)
      throw new BadRequestError("INVALID_INPUT", "Workout day must be 1 to 4");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });

    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetWorkoutDay(
        uid,
        week,
        dayNumber,
        session,
      );
    });

    return record;
  }

  // ============= READS =============

  static async updateReads(
    uid: string,
    day: number,
    completed: boolean,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.updateReads(uid, day, completed, session);
    });
    return record;
  }

  static async resetReads(
    uid: string,
    day: number,
  ): Promise<IChallengeRecord | null> {
    // Validation
    if (day < 1 || day > 30)
      throw new BadRequestError("INVALID_INPUT", "Day must be 1 to 30");

    let record: IChallengeRecord | null = await ChallengeRecord.findOne({
      uid,
    });
    if (!record)
      throw new NotFoundError(
        "RECORD_NOT_FOUND",
        "The user is currently not subscribed to an active challenge",
      );

    await runInTransaction(async (session: ClientSession) => {
      record = await ChallengeRecord.resetReads(uid, day, session);
    });
    return record;
  }
}
