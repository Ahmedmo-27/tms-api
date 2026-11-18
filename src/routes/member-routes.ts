import express from "express";
import { getMemberProfile } from "../controllers/client/member-controller";
import {
  getBookings,
  bookClass,
  cancelClass,
  getSchedule,
  attendClass,
  bookDropIn,
  cancelDropIn,
  subToWaitingList,
} from "../controllers/client/class-controller";
import {
  getMemberPackages,
  subToPackage,
  unsubFromPackage,
} from "../controllers/client/package-controller";
import {
  freezeMyPackage,
  unfreezeMyPackage,
  requestExtraFreeze,
  getMyFreezeRequests,
} from "../controllers/client/freeze-controller";
import { getPackage } from "../controllers/client/package-controller";
import { getCoaches } from "../controllers/admin/coach-controller";
import { getLocation } from "../controllers/admin/location-controller";
import {
  authorizeUser,
  authenticateUser,
} from "../middlewares/auth.middleware";
import {
  updateFcmToken,
  removeFcmToken,
} from "../controllers/admin/notifications-controller";
import { checkMobileAppVersion } from "../middlewares/appVersion.middleware";
import { mobileMemberPackagePacing } from "../middlewares/mobileMemberPacing";
import { cacheResponse } from "../middlewares/cacheResponse";
import {
  CacheTags,
  actorOf,
  memberTag,
} from "../cache/response-cache";

const memberRoutes = express.Router();
const memberOrPending = ["member", "user"] as const;

const memberPrivateCache = cacheResponse({
  ttlMs: 15_000,
  scope: "user",
  tags: (req) => [memberTag(actorOf(req)?.id)],
});
const profileCache = cacheResponse({
  ttlMs: 60_000,
  scope: "user",
  tags: (req) => [memberTag(actorOf(req)?.id)],
});
const packageCatalogCache = cacheResponse({
  ttlMs: 60_000,
  scope: "role",
  tags: [CacheTags.packages],
});
const scheduleCache = cacheResponse({
  ttlMs: 20_000,
  scope: "role",
  tags: [CacheTags.schedule],
});
const coachListCache = cacheResponse({
  ttlMs: 120_000,
  scope: "role",
  tags: [CacheTags.coaches],
});
const locationListCache = cacheResponse({
  ttlMs: 300_000,
  scope: "role",
  tags: [CacheTags.locations],
});

memberRoutes.use(checkMobileAppVersion);

// Profile Routes
memberRoutes.get(
  "/profile",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  profileCache,
  getMemberProfile
);

// Booking Routes
memberRoutes.get(
  "/classes",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  memberPrivateCache,
  getBookings
);
memberRoutes.post(
  "/book/:scid",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  bookClass
);
memberRoutes.post(
  "/dropIn",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  bookDropIn
);
memberRoutes.post(
  "/subToWaitingList",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  subToWaitingList
)
memberRoutes.delete(
  "/cancel/:scid",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  cancelClass
);
memberRoutes.post(
  "/cancel-dropin/:scid",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  cancelDropIn
)
memberRoutes.post(
  "/attend/:attendanceId",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  attendClass
);

// Package Routes
memberRoutes.get(
  "/packages",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  mobileMemberPackagePacing,
  packageCatalogCache,
  getPackage
);
memberRoutes.get(
  "/member-packages",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  memberPrivateCache,
  getMemberPackages
);
memberRoutes.post(
  "/packages",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  subToPackage
);
memberRoutes.delete(
  "/packages/:pkgId",
  authenticateUser,
  authorizeUser(["member"]),
  unsubFromPackage
);

// Freeze Routes
memberRoutes.post(
  "/packages/freeze",
  authenticateUser,
  authorizeUser(["member"]),
  freezeMyPackage
);
memberRoutes.post(
  "/packages/unfreeze",
  authenticateUser,
  authorizeUser(["member"]),
  unfreezeMyPackage
);
memberRoutes.post(
  "/packages/freeze-request",
  authenticateUser,
  authorizeUser(["member"]),
  requestExtraFreeze
);
memberRoutes.get(
  "/packages/freeze-requests",
  authenticateUser,
  authorizeUser(["member"]),
  memberPrivateCache,
  getMyFreezeRequests
);

// Schedule Routes
memberRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  scheduleCache,
  getSchedule
);

// Notifications Routes
memberRoutes.post(
  "/fcm/update-token/:fcmToken",
  authenticateUser,
  updateFcmToken
);
memberRoutes.delete(
  "/fcm/update-token/:fcmToken",
  authenticateUser,
  removeFcmToken
);

// Coaches Routes
memberRoutes.get(
  "/coaches",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  coachListCache,
  getCoaches
);

// Locations Routes
memberRoutes.get(
  "/locations",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  locationListCache,
  getLocation
);

export default memberRoutes;
