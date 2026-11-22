import mongoose, { Types } from "mongoose";
import { formatInTimeZone } from "date-fns-tz";
import User from "../models/user";
import Coach from "../models/coach";
import Class from "../models/class";
import Location from "../models/location";
import ScheduledClass from "../models/scheduledClass";
import ShadowCoachProgress, {
  STANDARD_SHADOW_COACH_CURRICULUM,
} from "../models/shadowCoachProgress";
import { ShadowCoachService } from "../services/shadow-coach-service";
import { SchedulerService } from "../services/scheduler-service";
import { ForbiddenError } from "../core/ApiError";

describe("Shadow Coach Role & 3-Month Training Program", () => {
  let managingCoachUser: any;
  let managingCoachDoc: any;
  let leadCoachUser: any;
  let leadCoachDoc: any;
  let shadowCoachUser: any;
  let shadowCoachDoc: any;
  let testLocation: any;
  let testClass: any;

  beforeAll(async () => {
    // Connect to in-memory or test database
    if (mongoose.connection.readyState === 0) {
      const uri = process.env.MONGO_URI || "mongodb://localhost:27017/tms_test";
      await mongoose.connect(uri);
    }
  });

  afterAll(async () => {
    // Cleanup
    await User.deleteMany({ email: /test-shadow-.*@test\.com/ });
    await Coach.deleteMany({ phoneNumber: /0199999999[0-9]/ });
    if (testClass?._id) await Class.deleteOne({ _id: testClass._id });
    if (testLocation?._id) await Location.deleteOne({ _id: testLocation._id });
    if (shadowCoachDoc?._id) {
      await ShadowCoachProgress.deleteMany({ coachId: shadowCoachDoc._id });
    }
    await ScheduledClass.deleteMany({ className: "Shadow Test Class" });
    await mongoose.disconnect();
  });

  it("1. Initializes curriculum and initializes ShadowCoachProgress with 3 phases", async () => {
    expect(STANDARD_SHADOW_COACH_CURRICULUM).toHaveLength(3);
    expect(STANDARD_SHADOW_COACH_CURRICULUM[0].title).toBe("Observe + support");
    expect(STANDARD_SHADOW_COACH_CURRICULUM[1].title).toBe("Assist + demonstrate");
    expect(STANDARD_SHADOW_COACH_CURRICULUM[2].title).toBe("Coach + lead (supervised)");

    // Create managing coach
    managingCoachUser = new User({
      name: "Managing Coach Test",
      email: "test-shadow-managing@test.com",
      phoneNumber: "01999999991",
      role: "managing_coach",
      tokens: [{ token: "jwt-man-1", device: "web" }],
    });
    await managingCoachUser.save();

    managingCoachDoc = new Coach({
      coachName: "Managing Coach Test",
      phoneNumber: "01999999991",
      userId: managingCoachUser._id,
    });
    await managingCoachDoc.save();

    // Create lead coach
    leadCoachUser = new User({
      name: "Lead Coach Test",
      email: "test-shadow-lead@test.com",
      phoneNumber: "01999999992",
      role: "coach",
      tokens: [{ token: "jwt-lead-1", device: "web" }],
    });
    await leadCoachUser.save();

    leadCoachDoc = new Coach({
      coachName: "Lead Coach Test",
      phoneNumber: "01999999992",
      userId: leadCoachUser._id,
    });
    await leadCoachDoc.save();

    // Create shadow coach
    shadowCoachUser = new User({
      name: "Shadow Coach Candidate",
      email: "test-shadow-candidate@test.com",
      phoneNumber: "01999999993",
      role: "shadow_coach",
      tokens: [{ token: "jwt-shadow-1", device: "web" }],
    });
    await shadowCoachUser.save();

    shadowCoachDoc = new Coach({
      coachName: "Shadow Coach Candidate",
      phoneNumber: "01999999993",
      userId: shadowCoachUser._id,
      isShadowCoach: true,
      currentPhase: 1,
      trainingStartDate: new Date(),
    });
    await shadowCoachDoc.save();

    const progress = await ShadowCoachService.initializeProgress(
      shadowCoachDoc._id,
      shadowCoachUser._id
    );

    expect(progress).toBeDefined();
    expect(progress.currentPhase).toBe(1);
    expect(progress.status).toBe("in_progress");
    expect(progress.phases).toHaveLength(3);
    expect(progress.phases[0].checklist).toHaveLength(4);
    expect(progress.phases[1].checklist).toHaveLength(3);
    expect(progress.phases[2].checklist).toHaveLength(4);
  });

  it("2. Enforces that only managing coaches can assign shadow coaches to a class", async () => {
    testLocation = new Location({
      branchName: "Shadow Test Branch",
      location: "Cairo",
      locationUrl: "https://maps.google.com/test",
    });
    await testLocation.save();

    testClass = new Class({
      title: "Shadow Test Class",
      category: "Functional",
      price: 100,
      locations: [testLocation._id],
    });
    await testClass.save();

    const startTime = new Date(Date.now() + 86400000).toISOString();
    const endTime = new Date(Date.now() + 90000000).toISOString();

    // Attempt assignment with non-managing role (e.g. branch_admin or coach) -> Must throw
    await expect(
      SchedulerService.scheduleClass(
        testClass._id.toString(),
        startTime,
        endTime,
        "15",
        leadCoachDoc._id.toString(),
        testLocation._id.toString(),
        shadowCoachDoc._id.toString(),
        "branch_admin" // Not managing_coach
      )
    ).rejects.toThrow(ForbiddenError);

    // Assignment by managing_coach -> Must succeed
    const scheduledClass = await SchedulerService.scheduleClass(
      testClass._id.toString(),
      startTime,
      endTime,
      "15",
      leadCoachDoc._id.toString(),
      testLocation._id.toString(),
      shadowCoachDoc._id.toString(),
      "managing_coach"
    );

    expect(scheduledClass).toBeDefined();
    expect(scheduledClass.shadowCoachId?.toString()).toBe(shadowCoachDoc._id.toString());
    expect(scheduledClass.shadowCoachName).toBe("Shadow Coach Candidate");
  });

  it("3. Verifies client / mobile endpoints strip shadow coach information", async () => {
    const scheduledClass = await ScheduledClass.findOne({ cid: testClass._id });
    expect(scheduledClass).toBeDefined();

    const targetDateStr = formatInTimeZone(scheduledClass!.startTime, "Africa/Cairo", "yyyy-MM-dd");

    // Client/mobile request with isClientOrMobile = true
    const clientSchedule = await SchedulerService.getSchedule(
      targetDateStr,
      testLocation._id.toString(),
      true // isClientOrMobile
    );

    const targetSession = clientSchedule.find(
      (s: any) => s._id?.toString() === (scheduledClass!._id as any).toString()
    ) as any;

    expect(targetSession).toBeDefined();
    // Shadow coach fields MUST be absent/undefined for client
    expect(targetSession.shadowCoachId).toBeUndefined();
    expect(targetSession.shadowCoachName).toBeUndefined();
    expect(targetSession.shadowCoach).toBeUndefined();
  });

  it("4. Allows lead coach to mark checklist items and auto-updates completion", async () => {
    // Lead coach marks Phase 1 items done
    const p1Items = ["m1_equip", "m1_welcome", "m1_warmup_support", "m1_observe_flow"];
    for (const key of p1Items) {
      await ShadowCoachService.markChecklistItem(
        shadowCoachDoc._id,
        key,
        true,
        { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName }
      );
    }

    let progress = await ShadowCoachService.getProgress(shadowCoachDoc._id);
    expect(progress.phases[0].isPhaseComplete).toBe(true);
    expect(progress.currentPhase).toBe(2); // Auto advanced to phase 2

    // Lead coach marks Phase 2 items done
    const p2Items = ["m2_demo", "m2_correct_form", "m2_cooldown"];
    for (const key of p2Items) {
      await ShadowCoachService.markChecklistItem(
        shadowCoachDoc._id,
        key,
        true,
        { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName }
      );
    }

    progress = await ShadowCoachService.getProgress(shadowCoachDoc._id);
    expect(progress.phases[1].isPhaseComplete).toBe(true);
    expect(progress.currentPhase).toBe(3); // Auto advanced to phase 3

    // Lead coach marks Phase 3 items done
    const p3Items = ["m3_lead_warmup", "m3_coach_room", "m3_lead_segment", "m3_engagement"];
    for (const key of p3Items) {
      await ShadowCoachService.markChecklistItem(
        shadowCoachDoc._id,
        key,
        true,
        { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName }
      );
    }

    progress = await ShadowCoachService.getProgress(shadowCoachDoc._id);
    expect(progress.isAllComplete).toBe(true);
    expect(progress.status).toBe("completed_pending_review");
    expect(progress.canEvaluate).toBe(true);
  });

  it("5. Allows managing coach to promote candidate to full coach", async () => {
    const evaluated = await ShadowCoachService.evaluateCandidate(
      shadowCoachDoc._id,
      managingCoachUser,
      "promote",
      "Candidate performed excellently during all 3 months."
    );

    expect(evaluated.status).toBe("graduated");
    expect(evaluated.reviewDecision).toBe("promoted");

    // Verify user role was upgraded to coach
    const updatedUser = await User.findById(shadowCoachUser._id);
    expect(updatedUser?.role).toBe("coach");

    // Verify Coach document is no longer marked as shadow
    const updatedCoach = await Coach.findById(shadowCoachDoc._id);
    expect(updatedCoach?.isShadowCoach).toBe(false);
  });
});
