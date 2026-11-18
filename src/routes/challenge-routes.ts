import { Router } from "express";
import {
  getMemberChallengeRecord,
  initMemberChallengeRecord,
  updateRun,
  resetRun,
  getRunDetails,
  updateMeditation,
  resetMeditation,
  updateWaterIntake,
  resetWaterIntake,
  getAllCharityPlaces,
  addCharityPlace,
  updateCharity,
  resetCharity,
  updateWorkoutDay,
  resetWorkoutDay,
  updateReads,
  resetReads,
  initRunChallengeRecord,
  initWorkoutChallenge,
  subToChallenge
} from "../controllers/client/challenge-controller";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { checkChallengeSubscription } from "../middlewares/challenge.middleware";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import {
  CacheTags,
  actorOf,
  challengeTag,
} from "../cache/response-cache";

const router = Router();

router.use(authenticateUser);

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  invalidateCache((current) => [
    challengeTag(actorOf(current)?.id),
    CacheTags.charityPlaces,
  ])(req, res, next);
});

// Catalog write — management only (before member gate)
router.post("/places", authorizeUser(["management"]), addCharityPlace);

router.use(authorizeUser(["member", "user"]));

// ============= SUBSCRIBE TO CHALLENGE =============
router.post("/subscribe", subToChallenge);
router.use(checkChallengeSubscription());

// ============= INIT =============
router.post("/init", initMemberChallengeRecord);
router.post("/initRun", initRunChallengeRecord);
router.post("/initWorkout", initWorkoutChallenge);

// ============= GET =============
router.get(
  "/record",
  cacheResponse({
    ttlMs: 20_000,
    scope: "user",
    tags: (req) => [challengeTag(actorOf(req)?.id)],
  }),
  getMemberChallengeRecord,
);

// ============= RUN CHALLENGE =============
router.post("/run/update", updateRun);
router.post("/run/reset", resetRun);
router.get(
  "/run/details",
  cacheResponse({
    ttlMs: 20_000,
    scope: "user",
    tags: (req) => [challengeTag(actorOf(req)?.id)],
  }),
  getRunDetails,
);

// ============= MEDITATION =============
router.post("/meditation/update", updateMeditation);
router.post("/meditation/reset", resetMeditation);

// ============= WATER INTAKE =============
router.post("/water-intake/update", updateWaterIntake);
router.post("/water-intake/reset", resetWaterIntake);

// ============= CHARITY =============
router.get(
  "/places",
  cacheResponse({
    ttlMs: 30_000,
    scope: "user",
    tags: [CacheTags.charityPlaces],
  }),
  getAllCharityPlaces,
);
router.post("/charity/update", updateCharity);
router.post("/charity/reset", resetCharity);

// ============= WORKOUT =============
router.post("/workout/update", updateWorkoutDay);
router.post("/workout/reset", resetWorkoutDay);

// ============= READS =============
router.post("/reads/update", updateReads);
router.post("/reads/reset", resetReads);

export default router;
