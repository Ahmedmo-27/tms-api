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
import { returnPublicPackages } from "../middlewares/publicPkgs.middleware";

const memberRoutes = express.Router();

// Profile Routes
memberRoutes.get(
  "/profile",
  authenticateUser,
  authorizeUser(["member", "user"]),
  getMemberProfile
);

// // PT Routes
// memberRoutes.post(
//   "/pt/:pkgId",
//   authenticateUser,
//   authorizeUser(["member"]),
//   attendPt
// );

// // OpenGym Routes
// memberRoutes.post(
//   "/opengym/:pkgId",
//   authenticateUser,
//   authorizeUser(["member"]),
//   attendOpenGym
// )

// Booking Routes
memberRoutes.get(
  "/classes",
  authenticateUser,
  authorizeUser(["member", "user"]),
  getBookings
);
memberRoutes.post(
  "/book/:scid",
  authenticateUser,
  authorizeUser(["member"]),
  bookClass
);
memberRoutes.post(
  "/dropIn",
  authenticateUser,
  authorizeUser(["member"]),
  bookDropIn
);
memberRoutes.post(
  "/subToWaitingList",
  authenticateUser,
  authorizeUser(["member"]),
  subToWaitingList
)
memberRoutes.delete(
  "/cancel/:scid",
  authenticateUser,
  authorizeUser(["member"]),
  cancelClass
);
memberRoutes.post(
  "/cancel-dropin/:scid",
  authenticateUser,
  authorizeUser(["member"]),
  cancelDropIn
)
memberRoutes.post(
  "/attend/:attendanceId",
  authenticateUser,
  authorizeUser(["member"]),
  attendClass
);

// Package Routes
memberRoutes.get(
  "/packages",
  authenticateUser,
  returnPublicPackages(),
  authorizeUser(["member"]),
  getPackage
);
memberRoutes.get(
  "/member-packages",
  authenticateUser,
  authorizeUser(["member"]),
  getMemberPackages
);
memberRoutes.post(
  "/packages",
  authenticateUser,
  authorizeUser(["member"]),
  subToPackage
);
memberRoutes.delete(
  "/packages/:pkgId",
  authenticateUser,
  authorizeUser(["member"]),
  unsubFromPackage
);

// Schedule Routes
memberRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser(["member"]),
  getSchedule
);

// Notifications Routes
memberRoutes.post(
  "/fcm/update-token/:fcmToken",
  authenticateUser,
  authorizeUser(["user", "member"]),
  updateFcmToken
);
memberRoutes.delete(
  "/fcm/update-token/:fcmToken",
  authenticateUser,
  authorizeUser(["user", "member"]),
  removeFcmToken
);

// Coaches Routes
memberRoutes.get(
  "/coaches",
  authenticateUser,
  authorizeUser(["member", "user"]),
  getCoaches
);

// Locations Routes
memberRoutes.get(
  "/locations",
  authenticateUser,
  authorizeUser(["member", "user"]),
  getLocation
);

export default memberRoutes;
