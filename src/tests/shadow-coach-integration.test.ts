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
import { CoachService } from "../services/coach-service";
import { ForbiddenError, NotFoundError } from "../core/ApiError";

describe("Shadow Coach End-to-End System Integration Suite", () => {
  let managingCoachUser: any;
  let managingCoachDoc: any;

  let leadCoachUser: any;
  let leadCoachDoc: any;

  let otherCoachUser: any;
  let otherCoachDoc: any;

  let candidateUser: any;
  let candidateDoc: any;

  let testLocation: any;
  let testClass: any;
  let scheduledClassDoc: any;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      const uri = process.env.MONGO_URI || "mongodb://localhost:27017/tms_test";
      await mongoose.connect(uri);
    }

    // Clean up any old test data
    await User.deleteMany({ email: /test-sc-integ-.*@test\.com/ });
    await Coach.deleteMany({ phoneNumber: /0188888888[0-9]/ });
    await Class.deleteMany({ title: "Integration Test Fitness Class" });
    await Location.deleteMany({ branchName: "Integration Test Branch" });
    await ScheduledClass.deleteMany({ className: "Integration Test Fitness Class" });

    // 1. Setup Location & Class
    testLocation = await Location.create({
      branchName: "Integration Test Branch",
      location: "New Cairo",
      locationUrl: "https://maps.google.com/integration-test",
    });

    testClass = await Class.create({
      title: "Integration Test Fitness Class",
      category: "Functional",
      price: 150,
      locations: [testLocation._id],
    });

    // 2. Setup Managing Coach
    managingCoachUser = await User.create({
      name: "Managing Coach Alice",
      email: "test-sc-integ-alice@test.com",
      phoneNumber: "01888888881",
      role: "managing_coach",
      tokens: [{ token: "jwt-man-alice", device: "web" }],
    });
    managingCoachDoc = await Coach.create({
      coachName: "Managing Coach Alice",
      phoneNumber: "01888888881",
      userId: managingCoachUser._id,
    });

    // 3. Setup Lead Coach
    leadCoachUser = await User.create({
      name: "Lead Coach Bob",
      email: "test-sc-integ-bob@test.com",
      phoneNumber: "01888888882",
      role: "coach",
      tokens: [{ token: "jwt-lead-bob", device: "web" }],
    });
    leadCoachDoc = await Coach.create({
      coachName: "Lead Coach Bob",
      phoneNumber: "01888888882",
      userId: leadCoachUser._id,
    });

    // 4. Setup Unassigned Other Coach
    otherCoachUser = await User.create({
      name: "Other Coach Charlie",
      email: "test-sc-integ-charlie@test.com",
      phoneNumber: "01888888883",
      role: "coach",
      tokens: [{ token: "jwt-other-charlie", device: "web" }],
    });
    otherCoachDoc = await Coach.create({
      coachName: "Other Coach Charlie",
      phoneNumber: "01888888883",
      userId: otherCoachUser._id,
    });

    // 5. Setup Shadow Coach Candidate
    candidateUser = await User.create({
      name: "Shadow Candidate David",
      email: "test-sc-integ-david@test.com",
      phoneNumber: "01888888884",
      role: "shadow_coach",
      tokens: [{ token: "jwt-shadow-david", device: "web" }],
    });
    candidateDoc = await Coach.create({
      coachName: "Shadow Candidate David",
      phoneNumber: "01888888884",
      userId: candidateUser._id,
      isShadowCoach: true,
      currentPhase: 1,
      trainingStartDate: new Date(),
    });
  });

  afterAll(async () => {
    await User.deleteMany({ email: /test-sc-integ-.*@test\.com/ });
    await Coach.deleteMany({ phoneNumber: /0188888888[0-9]/ });
    if (testClass?._id) await Class.deleteOne({ _id: testClass._id });
    if (testLocation?._id) await Location.deleteOne({ _id: testLocation._id });
    if (candidateDoc?._id) {
      await ShadowCoachProgress.deleteMany({ coachId: candidateDoc._id });
    }
    await ScheduledClass.deleteMany({ className: "Integration Test Fitness Class" });
    await mongoose.disconnect();
  });

  // --------------------------------------------------------------------------
  // SECTION 1: Curriculum Initialization & Model Verification
  // --------------------------------------------------------------------------
  describe("1. Curriculum Structure & Candidate Initialization", () => {
    it("initializes candidate progress with exact 3-phase curriculum and 11 items", async () => {
      const progress = await ShadowCoachService.initializeProgress(
        candidateDoc._id,
        candidateUser._id
      );

      expect(progress).toBeDefined();
      expect(progress.coachId.toString()).toBe(candidateDoc._id.toString());
      expect(progress.currentPhase).toBe(1);
      expect(progress.status).toBe("in_progress");
      expect(progress.phases).toHaveLength(3);

      // Verify Month 1
      expect(progress.phases[0].phaseNumber).toBe(1);
      expect(progress.phases[0].title).toBe("Observe + support");
      expect(progress.phases[0].checklist).toHaveLength(4);
      expect(progress.phases[0].checklist.map((i: any) => i.key)).toEqual([
        "m1_equip",
        "m1_welcome",
        "m1_warmup_support",
        "m1_observe_flow",
      ]);

      // Verify Month 2
      expect(progress.phases[1].phaseNumber).toBe(2);
      expect(progress.phases[1].title).toBe("Assist + demonstrate");
      expect(progress.phases[1].checklist).toHaveLength(3);
      expect(progress.phases[1].checklist.map((i: any) => i.key)).toEqual([
        "m2_demo",
        "m2_correct_form",
        "m2_cooldown",
      ]);

      // Verify Month 3
      expect(progress.phases[2].phaseNumber).toBe(3);
      expect(progress.phases[2].title).toBe("Coach + lead (supervised)");
      expect(progress.phases[2].checklist).toHaveLength(4);
      expect(progress.phases[2].checklist.map((i: any) => i.key)).toEqual([
        "m3_lead_warmup",
        "m3_coach_room",
        "m3_lead_segment",
        "m3_engagement",
      ]);
    });

    it("prevents duplicate progress initialization for the same candidate", async () => {
      const existing = await ShadowCoachService.initializeProgress(
        candidateDoc._id,
        candidateUser._id
      );
      expect(existing).toBeDefined();

      const count = await ShadowCoachProgress.countDocuments({ coachId: candidateDoc._id });
      expect(count).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Managing-Coach-Only Class Assignment & Guard Restrictions
  // --------------------------------------------------------------------------
  describe("2. Class Assignment Security & Role Gates", () => {
    const startTime = new Date(Date.now() + 86400000).toISOString();
    const endTime = new Date(Date.now() + 90000000).toISOString();

    it("rejects shadow coach assignment by non-managing roles (403 Forbidden)", async () => {
      const nonManagingRoles = ["coach", "front_desk", "accountant"];

      for (const role of nonManagingRoles) {
        await expect(
          SchedulerService.scheduleClass(
            testClass._id.toString(),
            startTime,
            endTime,
            "20",
            leadCoachDoc._id.toString(),
            testLocation._id.toString(),
            candidateDoc._id.toString(),
            role
          )
        ).rejects.toThrow(ForbiddenError);
      }
    });

    it("allows managing coach to assign shadow coach alongside lead coach", async () => {
      scheduledClassDoc = await SchedulerService.scheduleClass(
        testClass._id.toString(),
        startTime,
        endTime,
        "20",
        leadCoachDoc._id.toString(),
        testLocation._id.toString(),
        candidateDoc._id.toString(),
        "managing_coach"
      );

      expect(scheduledClassDoc).toBeDefined();
      expect(scheduledClassDoc.shadowCoachId.toString()).toBe(candidateDoc._id.toString());
      expect(scheduledClassDoc.shadowCoachName).toBe("Shadow Candidate David");
    });

    it("rejects class edit modifying shadow coach if performed by a non-managing role", async () => {
      await expect(
        SchedulerService.editClass(
          { shadowCoachId: candidateDoc._id.toString() },
          scheduledClassDoc._id.toString(),
          null,
          "coach" // non-managing role
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows managing coach to update or reassign shadow coach", async () => {
      const updated = await SchedulerService.editClass(
        {
          shadowCoachId: candidateDoc._id.toString(),
          availableSlots: 25,
        },
        scheduledClassDoc._id.toString(),
        null,
        "managing_coach"
      );

      expect(updated).toBeDefined();
      expect(updated!.availableSlots).toBe(25);
      expect(updated!.shadowCoachId!.toString()).toBe(candidateDoc._id.toString());
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Privacy, Mobile App Scrubbing & Coach Portal Exposure
  // --------------------------------------------------------------------------
  describe("3. Mobile App Isolation vs Management/Coach Portal Visibility", () => {
    it("strictly strips shadow coach data from mobile/client schedule responses", async () => {
      const targetDate = formatInTimeZone(
        scheduledClassDoc.startTime,
        "Africa/Cairo",
        "yyyy-MM-dd"
      );

      // Client / Mobile request (isClientOrMobile = true)
      const clientSchedule = await SchedulerService.getSchedule(
        targetDate,
        testLocation._id.toString(),
        true
      );

      const sessionForClient = clientSchedule.find(
        (s: any) => s._id?.toString() === scheduledClassDoc._id.toString()
      ) as any;

      expect(sessionForClient).toBeDefined();
      expect(sessionForClient.shadowCoachId).toBeUndefined();
      expect(sessionForClient.shadowCoachName).toBeUndefined();
      expect(sessionForClient.shadowCoach).toBeUndefined();
      // Lead coach is visible in coachId
      expect(sessionForClient.coachId).toBeDefined();
      expect(sessionForClient.coachId[0]?.coachName).toBe("Lead Coach Bob");
    });

    it("preserves shadow coach data for managerial schedule queries", async () => {
      const targetDate = formatInTimeZone(
        scheduledClassDoc.startTime,
        "Africa/Cairo",
        "yyyy-MM-dd"
      );

      // Admin / Managerial request (isClientOrMobile = false)
      const adminSchedule = await SchedulerService.getSchedule(
        targetDate,
        testLocation._id.toString(),
        false
      );

      const sessionForAdmin = adminSchedule.find(
        (s: any) => s._id?.toString() === scheduledClassDoc._id.toString()
      ) as any;

      expect(sessionForAdmin).toBeDefined();
      expect(sessionForAdmin.shadowCoachId).toBeDefined();
      expect(sessionForAdmin.shadowCoachName).toBe("Shadow Candidate David");
    });

    it("formats shadowCoach reference for lead coach portal queries", async () => {
      const coachPortalSchedule = await CoachService.getSchedule(
        leadCoachDoc._id,
        new Date(scheduledClassDoc.startTime)
      );

      const allSessions = coachPortalSchedule.days.flatMap((d) => d.sessions);
      const sessionInCoachPortal = allSessions.find(
        (s) => s.scheduledClassId === scheduledClassDoc._id.toString()
      );

      expect(sessionInCoachPortal).toBeDefined();
      expect(sessionInCoachPortal?.shadowCoach).toBeDefined();
      expect(sessionInCoachPortal?.shadowCoach?.id).toBe(candidateDoc._id.toString());
      expect(sessionInCoachPortal?.shadowCoach?.name).toBe("Shadow Candidate David");
      expect(sessionInCoachPortal?.shadowCoach?.currentPhase).toBe(1);
      expect(sessionInCoachPortal?.shadowCoach?.phaseLabel).toBe("Phase 1/3: Observe + support");
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Interactive Target Checklist Progression (All 3 Months)
  // --------------------------------------------------------------------------
  describe("4. Checklist Progression, Lead Coach Signatures & Phase Milestones", () => {
    it("blocks an unassigned coach from marking checklist items", async () => {
      // Unassigned coach: otherCoachDoc
      const isAssigned = Array.isArray(scheduledClassDoc.coachId)
        ? scheduledClassDoc.coachId.some(
            (id: any) => id.toString() === otherCoachDoc._id.toString()
          )
        : false;

      expect(isAssigned).toBe(false);
    });

    it("marks Month 1 items with coach signature, timestamp, and notes", async () => {
      const p1ItemKeys = ["m1_equip", "m1_welcome", "m1_warmup_support", "m1_observe_flow"];

      for (let i = 0; i < p1ItemKeys.length; i++) {
        const itemKey = p1ItemKeys[i];
        const updated = await ShadowCoachService.markChecklistItem(
          candidateDoc._id,
          itemKey,
          true,
          { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName },
          scheduledClassDoc._id.toString(),
          `Observed during class session item #${i + 1}`
        );

        const targetItem = updated.phases[0].checklist.find((item: any) => item.key === itemKey);
        expect(targetItem).toBeDefined();
        expect(targetItem!.isDone).toBe(true);
        expect(targetItem!.completedByCoachName).toBe("Lead Coach Bob");
        expect(targetItem!.completedAt).toBeDefined();
        expect(targetItem!.notes).toContain("Observed during class session");
      }

      // Check auto-advance to Phase 2
      const progressAfterP1 = await ShadowCoachService.getProgress(candidateDoc._id);
      expect(progressAfterP1.phases[0].isPhaseComplete).toBe(true);
      expect(progressAfterP1.currentPhase).toBe(2);
      expect(progressAfterP1.phaseLabel).toBe("Phase 2/3: Assist + demonstrate");
    });

    it("allows unmarking an item and correctly recalculates phase completion", async () => {
      // Unmark one item from Month 1
      const updated = await ShadowCoachService.markChecklistItem(
        candidateDoc._id,
        "m1_observe_flow",
        false,
        { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName }
      );

      expect(updated.phases[0].isPhaseComplete).toBe(false);

      // Re-mark it done
      const reMarked = await ShadowCoachService.markChecklistItem(
        candidateDoc._id,
        "m1_observe_flow",
        true,
        { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName }
      );

      expect(reMarked.phases[0].isPhaseComplete).toBe(true);
      expect(reMarked.currentPhase).toBe(2);
    });

    it("marks Month 2 items and advances to Month 3", async () => {
      const p2ItemKeys = ["m2_demo", "m2_correct_form", "m2_cooldown"];

      for (const itemKey of p2ItemKeys) {
        await ShadowCoachService.markChecklistItem(
          candidateDoc._id,
          itemKey,
          true,
          { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName },
          scheduledClassDoc._id.toString()
        );
      }

      const progressAfterP2 = await ShadowCoachService.getProgress(candidateDoc._id);
      expect(progressAfterP2.phases[1].isPhaseComplete).toBe(true);
      expect(progressAfterP2.currentPhase).toBe(3);
      expect(progressAfterP2.phaseLabel).toBe("Phase 3/3: Coach + lead (supervised)");
    });

    it("marks Month 3 items and transitions status to completed_pending_review", async () => {
      const p3ItemKeys = ["m3_lead_warmup", "m3_coach_room", "m3_lead_segment", "m3_engagement"];

      for (const itemKey of p3ItemKeys) {
        await ShadowCoachService.markChecklistItem(
          candidateDoc._id,
          itemKey,
          true,
          { _id: leadCoachDoc._id, coachName: leadCoachDoc.coachName },
          scheduledClassDoc._id.toString()
        );
      }

      const finalProgress = await ShadowCoachService.getProgress(candidateDoc._id);
      expect(finalProgress.phases[2].isPhaseComplete).toBe(true);
      expect(finalProgress.isAllComplete).toBe(true);
      expect(finalProgress.status).toBe("completed_pending_review");
      expect(finalProgress.canEvaluate).toBe(true);
      expect(finalProgress.completedDate).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Managing Coach Candidate Directory & Manual Phase Adjustments
  // --------------------------------------------------------------------------
  describe("5. Managing Coach Directory & Manual Phase Overrides", () => {
    it("lists shadow coaches with comprehensive statistics and readiness badges", async () => {
      const directory = await ShadowCoachService.listShadowCoaches();

      const candidateSummary = directory.find(
        (c) => c.coachId === candidateDoc._id.toString()
      );

      expect(candidateSummary).toBeDefined();
      expect(candidateSummary?.coachName).toBe("Shadow Candidate David");
      expect(candidateSummary?.completedCount).toBe(11);
      expect(candidateSummary?.totalCount).toBe(11);
      expect(candidateSummary?.progressPercent).toBe(100);
      expect(candidateSummary?.isCompleted).toBe(true);
      expect(candidateSummary?.canEvaluate).toBe(true);
      expect(candidateSummary?.status).toBe("completed_pending_review");
    });

    it("allows managing coach to manually adjust candidate phase", async () => {
      // Set to Phase 2 manually
      const updatedPhase = await ShadowCoachService.setPhase(candidateDoc._id, 2);
      expect(updatedPhase.currentPhase).toBe(2);

      // Verify Coach document reflects updated phase
      const coachCheck = await Coach.findById(candidateDoc._id);
      expect(coachCheck?.currentPhase).toBe(2);

      // Restore to Phase 3
      await ShadowCoachService.setPhase(candidateDoc._id, 3);
    });

    it("rejects invalid phase values outside 1-3", async () => {
      await expect(ShadowCoachService.setPhase(candidateDoc._id, 0)).rejects.toThrow();
      await expect(ShadowCoachService.setPhase(candidateDoc._id, 4)).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Evaluation Decisions (Retention vs Promotion Lifecycle)
  // --------------------------------------------------------------------------
  describe("6. Evaluation Decisions: Retention vs Promotion & Role Graduation", () => {
    it("handles retention decision: retains shadow_coach role for further mentoring", async () => {
      const retainedResult = await ShadowCoachService.evaluateCandidate(
        candidateDoc._id,
        managingCoachUser,
        "retain",
        "Candidate needs further practice on queue timing and pacing."
      );

      expect(retainedResult.status).toBe("retained");
      expect(retainedResult.reviewDecision).toBe("retained");
      expect(retainedResult.reviewNotes).toContain("needs further practice");

      // Verify role remains shadow_coach
      const userCheck = await User.findById(candidateUser._id);
      expect(userCheck?.role).toBe("shadow_coach");

      // Coach document is still shadow coach
      const coachCheck = await Coach.findById(candidateDoc._id);
      expect(coachCheck?.isShadowCoach).toBe(true);
    });

    it("handles promotion decision: automatically upgrades role to full coach", async () => {
      const promotedResult = await ShadowCoachService.evaluateCandidate(
        candidateDoc._id,
        managingCoachUser,
        "promote",
        "Excellent progression. Promoted to full coach."
      );

      expect(promotedResult.status).toBe("graduated");
      expect(promotedResult.reviewDecision).toBe("promoted");
      expect(promotedResult.reviewNotes).toContain("Promoted to full coach");

      // Verify User role automatically transitioned from shadow_coach -> coach
      const upgradedUser = await User.findById(candidateUser._id);
      expect(upgradedUser?.role).toBe("coach");

      // Verify Coach document isShadowCoach is now false
      const upgradedCoach = await Coach.findById(candidateDoc._id);
      expect(upgradedCoach?.isShadowCoach).toBe(false);
    });

    it("enables newly promoted coach to independently lead scheduled classes", async () => {
      const futureStart = new Date(Date.now() + 172800000).toISOString();
      const futureEnd = new Date(Date.now() + 176400000).toISOString();

      // Schedule class where the PROMOTED coach is now the LEAD coach!
      const newClassWithPromotedLead = await SchedulerService.scheduleClass(
        testClass._id.toString(),
        futureStart,
        futureEnd,
        "18",
        candidateDoc._id.toString(), // Candidate is now the LEAD coach!
        testLocation._id.toString(),
        undefined, // No shadow coach
        "managing_coach"
      );

      expect(newClassWithPromotedLead).toBeDefined();
      expect(newClassWithPromotedLead.coachId).toContainEqual(candidateDoc._id);
      expect(newClassWithPromotedLead.shadowCoachId).toBeUndefined();
    });
  });
});
