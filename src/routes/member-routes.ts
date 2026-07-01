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

const memberRoutes = express.Router();
const memberOrPending = ["member", "user"] as const;

// Profile Routes
memberRoutes.get(
  "/profile",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  getMemberProfile
);

// Booking Routes
memberRoutes.get(
  "/classes",
  authenticateUser,
  authorizeUser([...memberOrPending]),
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
  getPackage
);
memberRoutes.get(
  "/member-packages",
  authenticateUser,
  authorizeUser([...memberOrPending]),
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

// Schedule Routes
memberRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser([...memberOrPending]),
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
  authorizeUser([...memberOrPending]),
  getCoaches
);

// Locations Routes
memberRoutes.get(
  "/locations",
  authenticateUser,
  authorizeUser([...memberOrPending]),
  getLocation
);

export default memberRoutes;
