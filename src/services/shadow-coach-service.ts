import { Types, ClientSession } from "mongoose";
import ShadowCoachProgress, {
  buildInitialPhases,
  IShadowCoachProgress,
  STANDARD_SHADOW_COACH_CURRICULUM,
} from "../models/shadowCoachProgress";
import Coach, { ICoach } from "../models/coach";
import User, { IUser } from "../models/user";
import Class from "../models/class";
import Location from "../models/location";
import CoachNotification from "../models/coachNotification";
import { formatInTimeZone } from "date-fns-tz";
import { getIO } from "../config/socket";
import { BadRequestError, NotFoundError, ForbiddenError } from "../core/ApiError";
import logger from "../config/logger";

export interface ShadowCoachSummaryDto {
  coachId: string;
  coachName: string;
  phoneNumber: string;
  userId?: string;
  currentPhase: number;
  phaseLabel: string;
  status: "in_progress" | "completed_pending_review" | "graduated" | "retained";
  startDate: string;
  completedDate?: string;
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  isCompleted: boolean;
  canEvaluate: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewDecision?: "promoted" | "retained";
  reviewNotes?: string;
}

export class ShadowCoachService {
  static getPhaseTitle(phaseNumber: number): string {
    const found = STANDARD_SHADOW_COACH_CURRICULUM.find(
      (p) => p.phaseNumber === phaseNumber
    );
    return found ? found.title : `Phase ${phaseNumber}`;
  }

  static getPhaseLabel(phaseNumber: number): string {
    return `Phase ${phaseNumber}/3: ${this.getPhaseTitle(phaseNumber)}`;
  }

  static async initializeProgress(
    coachId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    session?: ClientSession | null
  ): Promise<IShadowCoachProgress> {
    const cId = new Types.ObjectId(coachId);
    const uId = new Types.ObjectId(userId);

    let progress = await ShadowCoachProgress.findOne({ coachId: cId }).session(
      session ?? null
    );
    if (!progress) {
      progress = new ShadowCoachProgress({
        coachId: cId,
        userId: uId,
        currentPhase: 1,
        startDate: new Date(),
        status: "in_progress",
        phases: buildInitialPhases(),
      });
      await progress.save(session ? { session } : {});
      logger.info("Initialized shadow coach progress", { coachId: cId, userId: uId });
    }
    return progress;
  }

  static async getOrCreateProgress(
    coachId: Types.ObjectId | string
  ): Promise<IShadowCoachProgress> {
    const cId = new Types.ObjectId(coachId);
    let progress: IShadowCoachProgress | null = await ShadowCoachProgress.findOne({ coachId: cId });
    if (!progress) {
      const coach = await Coach.findById(cId);
      if (!coach) {
        throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { coachId });
      }
      if (!coach.userId) {
        throw new BadRequestError(
          "COACH_HAS_NO_USER",
          "Shadow coach does not have an associated user account"
        );
      }
      progress = await this.initializeProgress(coach._id as Types.ObjectId, coach.userId);
    }
    return progress!;
  }

  static async listShadowCoaches(): Promise<ShadowCoachSummaryDto[]> {
    const coaches = await Coach.find({ isShadowCoach: true })
      .populate("userId", "name phoneNumber role")
      .lean();

    const coachIds = coaches.map((c) => c._id);
    const progressList = await ShadowCoachProgress.find({
      coachId: { $in: coachIds },
    }).lean();

    const progressMap = new Map<string, any>();
    for (const p of progressList) {
      progressMap.set(p.coachId.toString(), p);
    }

    const summaries: ShadowCoachSummaryDto[] = [];
    for (const c of coaches) {
      const p = progressMap.get(c._id.toString());
      let completedCount = 0;
      let totalCount = 0;

      if (p && Array.isArray(p.phases)) {
        for (const phase of p.phases) {
          if (Array.isArray(phase.checklist)) {
            for (const item of phase.checklist) {
              totalCount++;
              if (item.isDone) completedCount++;
            }
          }
        }
      } else {
        totalCount = 11; // 4 + 3 + 4 standard items
      }

      const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
      const isCompleted = totalCount > 0 && completedCount >= totalCount;
      const currentPhase = p?.currentPhase ?? c.currentPhase ?? 1;

      summaries.push({
        coachId: c._id.toString(),
        coachName: c.coachName,
        phoneNumber: c.phoneNumber,
        userId: c.userId ? (c.userId as any)._id?.toString() || c.userId.toString() : undefined,
        currentPhase,
        phaseLabel: this.getPhaseLabel(currentPhase),
        status: p?.status ?? (isCompleted ? "completed_pending_review" : "in_progress"),
        startDate: p?.startDate?.toISOString() ?? c.trainingStartDate?.toISOString() ?? new Date().toISOString(),
        completedDate: p?.completedDate ? p.completedDate.toISOString() : undefined,
        completedCount,
        totalCount,
        progressPercent,
        isCompleted,
        canEvaluate: isCompleted && (p?.status === "in_progress" || p?.status === "completed_pending_review"),
        reviewedBy: p?.reviewedBy?.toString(),
        reviewedAt: p?.reviewedAt ? p.reviewedAt.toISOString() : undefined,
        reviewDecision: p?.reviewDecision,
        reviewNotes: p?.reviewNotes,
      });
    }

    return summaries;
  }

  static async getProgress(coachId: string | Types.ObjectId) {
    const progress = await this.getOrCreateProgress(coachId);
    const coach = await Coach.findById(coachId).populate("userId", "name phoneNumber role");
    if (!coach) {
      throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { coachId });
    }

    let completedCount = 0;
    let totalCount = 0;

    const phaseStats = progress.phases.map((ph) => {
      const phTotal = ph.checklist.length;
      const phDone = ph.checklist.filter((i) => i.isDone).length;
      completedCount += phDone;
      totalCount += phTotal;
      return {
        phaseNumber: ph.phaseNumber,
        title: ph.title,
        guidelines: ph.guidelines,
        total: phTotal,
        done: phDone,
        isPhaseComplete: phTotal > 0 && phDone >= phTotal,
        checklist: ph.checklist,
      };
    });

    const isAllComplete = totalCount > 0 && completedCount >= totalCount;

    return {
      coachId: (coach._id as Types.ObjectId).toString(),
      coachName: coach.coachName,
      phoneNumber: coach.phoneNumber,
      userId: coach.userId ? (coach.userId as any)._id?.toString() || coach.userId.toString() : null,
      currentPhase: progress.currentPhase,
      phaseLabel: this.getPhaseLabel(progress.currentPhase),
      status: progress.status,
      startDate: progress.startDate,
      completedDate: progress.completedDate,
      totalCount,
      completedCount,
      progressPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      isAllComplete,
      canEvaluate: isAllComplete && (progress.status === "in_progress" || progress.status === "completed_pending_review"),
      reviewDecision: progress.reviewDecision,
      reviewedAt: progress.reviewedAt,
      reviewNotes: progress.reviewNotes,
      phases: phaseStats,
    };
  }

  static async markChecklistItem(
    coachId: string | Types.ObjectId,
    itemKey: string,
    isDone: boolean,
    verifierCoach: { _id: Types.ObjectId; coachName?: string },
    scheduledClassId?: Types.ObjectId | string,
    notes?: string
  ) {
    const progress = await this.getOrCreateProgress(coachId);

    let targetItem: any = null;
    let itemPhaseNumber = 1;

    for (const ph of progress.phases) {
      for (const item of ph.checklist) {
        if (item.key === itemKey) {
          targetItem = item;
          itemPhaseNumber = ph.phaseNumber;
          break;
        }
      }
      if (targetItem) break;
    }

    if (!targetItem) {
      throw new NotFoundError(
        "CHECKLIST_ITEM_NOT_FOUND",
        `Checklist item "${itemKey}" not found in shadow coach curriculum`,
        { itemKey }
      );
    }

    targetItem.isDone = Boolean(isDone);
    if (isDone) {
      targetItem.completedAt = new Date();
      targetItem.completedByCoachId = verifierCoach._id;
      targetItem.completedByCoachName = verifierCoach.coachName ?? "Lead Coach";
      if (scheduledClassId && Types.ObjectId.isValid(scheduledClassId)) {
        targetItem.completedInClassId = new Types.ObjectId(scheduledClassId);
      }
    } else {
      targetItem.completedAt = undefined;
      targetItem.completedByCoachId = undefined;
      targetItem.completedByCoachName = undefined;
      targetItem.completedInClassId = undefined;
    }

    if (notes !== undefined) {
      targetItem.notes = notes;
    }

    // Check all phases completion
    let allDone = true;
    for (const ph of progress.phases) {
      for (const item of ph.checklist) {
        if (!item.isDone) {
          allDone = false;
          break;
        }
      }
      if (!allDone) break;
    }

    if (allDone) {
      if (progress.status === "in_progress") {
        progress.status = "completed_pending_review";
        progress.completedDate = new Date();
      }
    } else {
      if (progress.status === "completed_pending_review") {
        progress.status = "in_progress";
        progress.completedDate = undefined;
      }
    }

    // Auto-advance currentPhase if previous phase is complete and candidate is behind
    const phase1Complete = progress.phases[0]?.checklist.every((i) => i.isDone);
    const phase2Complete = progress.phases[1]?.checklist.every((i) => i.isDone);
    if (phase1Complete && phase2Complete && progress.currentPhase < 3) {
      progress.currentPhase = 3;
      await Coach.findByIdAndUpdate(coachId, { currentPhase: 3 });
    } else if (phase1Complete && progress.currentPhase < 2) {
      progress.currentPhase = 2;
      await Coach.findByIdAndUpdate(coachId, { currentPhase: 2 });
    }

    await progress.save();
    return this.getProgress(coachId);
  }

  static async setPhase(coachId: string | Types.ObjectId, phase: number) {
    if (phase < 1 || phase > 3) {
      throw new BadRequestError("INVALID_PHASE", "Phase must be between 1 and 3", { phase });
    }
    const progress = await this.getOrCreateProgress(coachId);
    progress.currentPhase = phase;
    await progress.save();

    await Coach.findByIdAndUpdate(coachId, { currentPhase: phase });
    return this.getProgress(coachId);
  }

  static async evaluateCandidate(
    coachId: string | Types.ObjectId,
    managingCoachUser: IUser,
    decision: "promote" | "retain",
    notes?: string
  ) {
    if (managingCoachUser.role !== "managing_coach") {
      throw new ForbiddenError(
        "MANAGING_COACH_ONLY",
        "Only managing coaches can evaluate shadow coaches"
      );
    }

    if (decision !== "promote" && decision !== "retain") {
      throw new BadRequestError("INVALID_DECISION", "Decision must be 'promote' or 'retain'");
    }

    const progress = await this.getOrCreateProgress(coachId);
    const coach = await Coach.findById(coachId);
    if (!coach) {
      throw new NotFoundError("COACH_NOT_FOUND", "Coach not found", { coachId });
    }

    const now = new Date();
    progress.reviewedBy = managingCoachUser._id as Types.ObjectId;
    progress.reviewedAt = now;
    progress.reviewDecision = decision === "promote" ? "promoted" : "retained";
    if (notes) progress.reviewNotes = notes;

    if (decision === "promote") {
      progress.status = "graduated";
      // Convert user role from shadow_coach to coach
      if (coach.userId) {
        await User.findByIdAndUpdate(coach.userId, { role: "coach" });
      }
      coach.isShadowCoach = false;
      await coach.save();
      logger.info("Shadow coach promoted to full coach", {
        coachId,
        userId: coach.userId,
        evaluatedBy: managingCoachUser._id,
      });
    } else {
      progress.status = "retained";
      coach.isShadowCoach = true;
      await coach.save();
      logger.info("Shadow coach retained in training program", {
        coachId,
        userId: coach.userId,
        evaluatedBy: managingCoachUser._id,
      });
    }

    await progress.save();
    return this.getProgress(coachId);
  }

  /**
   * Sends an in-app notification to the shadow coach informing them of their new class assignment.
   */
  static async notifyClassAssignment(
    shadowCoachId: Types.ObjectId,
    scheduledClass: any
  ): Promise<void> {
    try {
      const cls = await Class.findById(scheduledClass.cid);
      const classTitle = cls?.title || scheduledClass.className || "Class Session";

      let locationName = "";
      if (scheduledClass.locationId) {
        const loc = await Location.findById(scheduledClass.locationId);
        locationName = loc?.branchName || loc?.location || "";
      }

      let leadCoachName = scheduledClass.coachName || "";
      if (!leadCoachName && scheduledClass.coachId) {
        const coachIds = Array.isArray(scheduledClass.coachId)
          ? scheduledClass.coachId
          : [scheduledClass.coachId];
        const coaches = await Coach.find({ _id: { $in: coachIds } }).select("coachName");
        leadCoachName = coaches.map((c: any) => c.coachName).join(", ");
      }

      const dateStr = formatInTimeZone(new Date(scheduledClass.startTime), "Africa/Cairo", "EEE, MMM d");
      const timeStr = `${formatInTimeZone(new Date(scheduledClass.startTime), "Africa/Cairo", "hh:mm a")} – ${formatInTimeZone(new Date(scheduledClass.endTime), "Africa/Cairo", "hh:mm a")}`;

      const notification = await CoachNotification.create({
        coachId: shadowCoachId,
        type: "class_assignment",
        title: `Class Assignment: ${classTitle}`,
        message: `You have been assigned to shadow ${classTitle} on ${dateStr} (${timeStr})${locationName ? ` at ${locationName}` : ""}${leadCoachName ? ` with lead coach ${leadCoachName}` : ""}.`,
        scheduledClassId: scheduledClass._id,
        classTitle,
        startTime: scheduledClass.startTime,
        endTime: scheduledClass.endTime,
        locationName,
        leadCoachName,
        read: false,
      });

      const io = getIO();
      if (io) {
        const notifDoc = notification as any;
        const payload = {
          id: notifDoc._id ? notifDoc._id.toString() : "",
          type: "class_assignment",
          title: notifDoc.title,
          message: notifDoc.message,
          scheduledClassId: scheduledClass._id ? scheduledClass._id.toString() : "",
          classTitle,
          startTime: scheduledClass.startTime instanceof Date ? scheduledClass.startTime.toISOString() : new Date(scheduledClass.startTime).toISOString(),
          endTime: scheduledClass.endTime instanceof Date ? scheduledClass.endTime.toISOString() : new Date(scheduledClass.endTime).toISOString(),
          locationName,
          leadCoachName,
          read: false,
          createdAt: notifDoc.createdAt instanceof Date ? notifDoc.createdAt.toISOString() : new Date(notifDoc.createdAt || Date.now()).toISOString(),
        };

        io.to(`coach:${shadowCoachId.toString()}`).emit("coach:classAssignment", payload);

        const coach = await Coach.findById(shadowCoachId);
        if (coach?.userId) {
          io.to(`coach:${coach.userId.toString()}`).emit("coach:classAssignment", payload);
          io.to(`user:${coach.userId.toString()}`).emit("coach:classAssignment", payload);
        }
      }

      logger.info("Notified shadow coach of class assignment", {
        shadowCoachId,
        scheduledClassId: scheduledClass._id,
        classTitle,
      });
    } catch (err) {
      logger.error("Failed to notify shadow coach of class assignment", { error: err });
    }
  }
}
