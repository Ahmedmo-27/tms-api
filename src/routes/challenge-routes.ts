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

const router = Router();

router.use(authenticateUser);

// ============= SUBSCRIBE TO CHALLENGE =============
router.post("/subscribe", subToChallenge);
router.use(checkChallengeSubscription());

// ============= INIT =============
router.post("/init", initMemberChallengeRecord);
router.post("/initRun", initRunChallengeRecord)
router.post("/initWorkout", initWorkoutChallenge)


// ============= GET =============
router.get("/record", getMemberChallengeRecord);


// ============= RUN CHALLENGE =============
router.post("/run/update", updateRun);
router.post("/run/reset", resetRun);
router.get("/run/details", getRunDetails);

// ============= MEDITATION =============
router.post("/meditation/update", updateMeditation);
router.post("/meditation/reset", resetMeditation);

// ============= WATER INTAKE =============
router.post("/water-intake/update", updateWaterIntake);
router.post("/water-intake/reset", resetWaterIntake);

// ============= CHARITY =============
router.post("/places", addCharityPlace);
router.get("/places", getAllCharityPlaces);
router.post("/charity/update", updateCharity);
router.post("/charity/reset", resetCharity);

// ============= WORKOUT =============
router.post("/workout/update", updateWorkoutDay);
router.post("/workout/reset", resetWorkoutDay);

// ============= READS =============
router.post("/reads/update", updateReads);
router.post("/reads/reset", resetReads);

export default router;