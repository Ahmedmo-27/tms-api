import express from "express";
import {
  authorizeUser,
  authenticateUser,
} from "../middlewares/auth.middleware";
import {
  getScheduledClasses,
  getNextScheduledClasses,
  scheduleClass,
  cancelClass,
  editClass,
  getDailyAttendnace,
  confirmClassAttendance,
} from "../controllers/admin/scheduler-controller";
import {
  addClass,
  getClass,
  updateClass,
  deleteClass,
  getMemberBookings,
  bookClass,
  cancelBooking,
  bookDropIn,
  getOpenGymDropInPrice,
  listOpenGymDropInPrices,
  setOpenGymDropInPrice,
  recordOpenGymMemberDropIn,
  recordOpenGymGuestDropIn,
  getPtDropInPrice,
  listPtDropInPrices,
  setPtDropInPrice,
  listPtCoachDropInPrices,
  setPtCoachDropInPrice,
  recordPtMemberDropIn,
  recordPtGuestDropIn,
  bookNonUser,
  getNonUserBookings,
  recordNonUserAttendance,
  recordNonUserFoc,
  cancelNonUserBooking,
  updateNonUserBookingPhone,
  addWalkIn,
  saveNonUserPayment,
  manualRecordMemberAttendance,
  manualRemoveMemberAttendance,
  removeFailedScan,
  overrideAddToWaitlist,
  overrideRemoveFromWaitlist,
  getWaitlistedMembers,
  promoteFromWaitlist,
} from "../controllers/admin/class-controller";
import {
  addPackage,
  getPackage,
  deletePackage,
  getPackageDeletionImpactReport,
  updatePackage,
  subMemberToPackage,
  unsubMemberFromPackage,
  editMemberPackage,
  adjustMemberPackageClasses,
  recordMemberPreviousSessions,
  addNonUserPackage,
  getNonUserPackages,
} from "../controllers/admin/package-controller";
import {
  getFreezeRequests,
  getFrozenPackages,
  approveFreezeRequest,
  rejectFreezeRequest,
  adminFreezePackage,
  adminUnfreezePackage,
} from "../controllers/admin/freeze-controller";
import {
  addCoach,
  getCoaches,
  updateCoach,
  deleteCoach,
} from "../controllers/admin/coach-controller";
import { getManagingShadowCoaches } from "../controllers/coach/shadow-coach-controller";
import {
  addMember,
  exportMembers,
  getMember,
  updateMember,
} from "../controllers/admin/member-controller";
import {
  getAttendanceHistory,
  getOwedPtSessions,
  settleOwedPtSession,
} from "../controllers/admin/attendance-controller";
import {
  deleteScanRow,
  getScanRow,
  moveScanToClass,
  updateScanRow,
} from "../controllers/admin/scan-admin-controller";
import {
  getPendingMembers,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/admin/user-contoller";
import {
  sendCustomNotification,
  sendNotificationBatch,
  getNotificationHistory,
  getNotificationStats,
} from "../controllers/admin/notifications-controller";
import {
  addLocation,
  getLocation,
  updateLocation,
  deleteLocation,
  getPaymentsPin,
  updatePaymentsPin,
  verifyPaymentsPin,
} from "../controllers/admin/location-controller";
import {
  getPayments,
  updatePayment,
  deletePayment,
  syncPaymentToCoachera,
} from "../controllers/admin/payments-controller";
import {
  getProducts,
  editProduct,
  deleteProduct,
  addProduct,
} from "../controllers/admin/products-controller";
import {
  getOrders,
  createOrder,
  deleteOrder,
} from "../controllers/admin/orders-controller";
import {
  getTickets,
  submitTicket,
  updateTicketStatus,
  getTicketCategories,
  addTicketCategory,
  updateTicketCategory,
  deleteTicketCategory,
} from "../controllers/admin/ticket-controller";
import {
  createMemberRefund,
  createCashOut,
  getRefundByPaymentId,
  listRefunds,
  listCashOuts,
  searchMembers,
  getMemberRecentPayments,
} from "../controllers/admin/refunds-controller";
import {
  sendMail,
  getLogs,
  getInbox,
  getMailProfile,
  triggerSync,
  getUnreadCount,
  markEmailAsRead,
  markAllEmailsRead,
} from "../controllers/admin/mail-controller";
import {
  getCurrentHourSlot,
  updateChecklistItem,
  batchUpdateChecklist,
  getManagementOverview,
  getMaintenanceHistory,
} from "../controllers/admin/maintenance-controller";
import {
  getSheetDay,
  getSheetMemberEligibility,
  commitSheetRows,
  importSheetDay,
} from "../controllers/admin/sheet-controller";
import { getPtAchievementReport } from "../controllers/admin/pt-achievement-controller";
import { clearFinanceCache } from "../services/finance-service";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

const adminRoutes = express.Router();

const HOT = 20_000;
const LIST = 30_000;
const REF = 60_000;
const SHORT = 15_000;

const adminRead = (ttlMs: number, ...tags: string[]) =>
  cacheResponse({ ttlMs, scope: "user", tags });

/** Drops the finance service map and the HTTP finance entries after a money write. */
function bustFinanceCache(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) clearFinanceCache();
  });
  next();
}

// Member Routes
adminRoutes.get(
  "/member",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(LIST, CacheTags.members),
  getMember
);
adminRoutes.post(
  "/member/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.members, CacheTags.memberPackages]),
  addMember
);
adminRoutes.patch(
  "/member/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.members, CacheTags.memberPackages]),
  updateMember
);
adminRoutes.get(
  "/pending-members",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.members),
  getPendingMembers
);

// User & Account Management Routes (Management & Branch Admin)
adminRoutes.get(
  "/users",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(LIST, CacheTags.users),
  listUsers
);
adminRoutes.post(
  "/users",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.users]),
  createUser
);
adminRoutes.patch(
  "/users/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.users]),
  updateUser
);
adminRoutes.delete(
  "/users/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.users, CacheTags.members]),
  deleteUser
);

// Scheduling Routes
adminRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.schedule),
  getScheduledClasses
);
adminRoutes.get(
  "/next-schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.schedule),
  getNextScheduledClasses
);
adminRoutes.post(
  "/schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule]),
  scheduleClass
);
adminRoutes.delete(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  cancelClass
);
adminRoutes.patch(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule]),
  editClass
);
adminRoutes.post(
  "/schedule/:scid/confirm-attendance",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.attendance]),
  confirmClassAttendance
);
adminRoutes.get(
  "/daily-attendance",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(SHORT, CacheTags.attendance),
  getDailyAttendnace
);
adminRoutes.get(
  "/attendance",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.attendance),
  getAttendanceHistory
);

// Class CRUD Routes
adminRoutes.get(
  "/class",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.classes),
  getClass
);
adminRoutes.post(
  "/class",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.classes, CacheTags.schedule]),
  addClass
);
adminRoutes.patch(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.classes, CacheTags.schedule]),
  updateClass
);
adminRoutes.delete(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.classes, CacheTags.schedule]),
  deleteClass
);

// Booking Routes
adminRoutes.get(
  "/bookings",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.bookings, CacheTags.schedule),
  getMemberBookings
);
adminRoutes.post(
  "/book",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  bookClass
);
adminRoutes.delete(
  "/cancel",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  cancelBooking
);

adminRoutes.get(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(SHORT, CacheTags.schedule),
  getWaitlistedMembers
);

adminRoutes.post(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  overrideAddToWaitlist
);

adminRoutes.delete(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  overrideRemoveFromWaitlist
);

adminRoutes.post(
  "/bookings/waitlist/promote",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  promoteFromWaitlist
);

adminRoutes.post(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  manualRecordMemberAttendance
);

adminRoutes.delete(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  manualRemoveMemberAttendance
);

adminRoutes.delete(
  "/attendance/failed-scan",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance]),
  removeFailedScan
);

// Scans Monitor row corrections. :source is class | pt | open-gym, :parentId is
// the scheduled class (class) or the daily attendance document (pt, open-gym).
adminRoutes.get(
  "/scans/:source/:parentId/:rowId",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(SHORT, CacheTags.attendance),
  getScanRow
);

adminRoutes.patch(
  "/scans/:source/:parentId/:rowId",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  updateScanRow
);

adminRoutes.delete(
  "/scans/:source/:parentId/:rowId",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  deleteScanRow
);

adminRoutes.post(
  "/scans/:source/:parentId/:rowId/move-class",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  moveScanToClass
);

adminRoutes.post(
  "/bookDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.schedule, CacheTags.bookings]),
  bookDropIn
);

adminRoutes.get(
  "/openGym/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.dropInPrices),
  getOpenGymDropInPrice
);

adminRoutes.get(
  "/openGym/dropInPrices",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.dropInPrices),
  listOpenGymDropInPrices
);

adminRoutes.patch(
  "/openGym/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.dropInPrices]),
  setOpenGymDropInPrice
);

adminRoutes.post(
  "/openGym/memberDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance, CacheTags.schedule]),
  recordOpenGymMemberDropIn
);

adminRoutes.post(
  "/openGym/guestDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance]),
  recordOpenGymGuestDropIn
);

adminRoutes.get(
  "/pt/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.dropInPrices),
  getPtDropInPrice
);

adminRoutes.get(
  "/pt/dropInPrices",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.dropInPrices),
  listPtDropInPrices
);

adminRoutes.patch(
  "/pt/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.dropInPrices]),
  setPtDropInPrice
);

adminRoutes.get(
  "/pt/coachDropInPrices",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.dropInPrices),
  listPtCoachDropInPrices
);

adminRoutes.patch(
  "/pt/coachDropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.dropInPrices]),
  setPtCoachDropInPrice
);

adminRoutes.post(
  "/pt/memberDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance]),
  recordPtMemberDropIn
);

adminRoutes.post(
  "/pt/guestDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance]),
  recordPtGuestDropIn
);

adminRoutes.get(
  "/pt/owed-sessions",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.attendance),
  getOwedPtSessions
);

adminRoutes.post(
  "/pt/settle-session",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.attendance]),
  settleOwedPtSession
);

adminRoutes.get(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.nonUser, CacheTags.bookings),
  getNonUserBookings
)

adminRoutes.post(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.schedule, CacheTags.bookings]),
  bookNonUser
)

adminRoutes.post(
  "/nonUserBooking/attend",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.attendance, CacheTags.schedule]),
  recordNonUserAttendance
)

adminRoutes.post(
  "/nonUserBooking/pay",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.payments]),
  saveNonUserPayment
)

adminRoutes.post(
  "/nonUserBooking/foc",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser]),
  recordNonUserFoc
)

adminRoutes.post(
  "/nonUserBooking/cancel/:bookingId",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.schedule, CacheTags.bookings]),
  cancelNonUserBooking
)

adminRoutes.patch(
  "/nonUserBooking/:bookingId/phone",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser]),
  updateNonUserBookingPhone
)

adminRoutes.patch(
  "/nonUserBooking/:bookingId/name",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser]),
  updateNonUserBookingPhone
)

adminRoutes.patch(
  "/nonUserBooking/:bookingId",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser]),
  updateNonUserBookingPhone
)

adminRoutes.post(
  "/nonUserBooking/walk-in",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.schedule, CacheTags.attendance]),
  addWalkIn
)

adminRoutes.post(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.nonUser, CacheTags.packages]),
  addNonUserPackage
)

adminRoutes.get(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(HOT, CacheTags.nonUser),
  getNonUserPackages
)

// Packages CRUD Routes
adminRoutes.get(
  "/packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.packages),
  getPackage
);
adminRoutes.post(
  "/packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.packages]),
  addPackage
);
adminRoutes.get(
  "/packages/:id/deletion-impact",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(SHORT, CacheTags.packages),
  getPackageDeletionImpactReport
);
adminRoutes.delete(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.packages, CacheTags.memberPackages]),
  deletePackage
);
adminRoutes.patch(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.packages]),
  updatePackage
);

// Member Packages Routes
adminRoutes.post(
  "/member-packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.members]),
  subMemberToPackage
);
adminRoutes.delete(
  "/member-packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.members]),
  unsubMemberFromPackage
);
adminRoutes.patch(
  "/member-packages/edit",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.members]),
  editMemberPackage
);
adminRoutes.patch(
  "/member-packages/adjust",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.members, CacheTags.attendance]),
  adjustMemberPackageClasses
);
adminRoutes.post(
  "/member-packages/previous-sessions",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.attendance]),
  recordMemberPreviousSessions
);
adminRoutes.post(
  "/member-packages/freeze",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.freeze, CacheTags.members]),
  adminFreezePackage
);
adminRoutes.post(
  "/member-packages/unfreeze",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.memberPackages, CacheTags.freeze, CacheTags.members]),
  adminUnfreezePackage
);

// Freeze Requests & Frozen Packages Routes
adminRoutes.get(
  "/freeze-requests",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.freeze),
  getFreezeRequests
);
adminRoutes.get(
  "/frozen-packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.freeze, CacheTags.memberPackages),
  getFrozenPackages
);
adminRoutes.patch(
  "/freeze-requests/:id/approve",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.freeze, CacheTags.memberPackages, CacheTags.members]),
  approveFreezeRequest
);
adminRoutes.patch(
  "/freeze-requests/:id/reject",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.freeze]),
  rejectFreezeRequest
);

// Notification Routes
adminRoutes.post(
  "/send-message",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.notifications]),
  sendCustomNotification
);
adminRoutes.post(
  "/notifications/send",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.notifications]),
  sendNotificationBatch
);
adminRoutes.get(
  "/notifications/history",
  authenticateUser,
  authorizeUser(["management"]),
  adminRead(HOT, CacheTags.notifications),
  getNotificationHistory
);
adminRoutes.get(
  "/notifications/stats",
  authenticateUser,
  authorizeUser(["management"]),
  adminRead(HOT, CacheTags.notifications),
  getNotificationStats
);

// Coach Management Routes
adminRoutes.get(
  "/coaches",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(REF, CacheTags.coaches),
  getCoaches
);
adminRoutes.post(
  "/coaches",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.coaches]),
  addCoach
);
adminRoutes.patch(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.coaches]),
  updateCoach
);
adminRoutes.delete(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.coaches]),
  deleteCoach
);

// Shadow Coach Management Routes
adminRoutes.get(
  "/shadow-coaches",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "managing_coach"]),
  getManagingShadowCoaches
);

// Location Routes
adminRoutes.get(
  "/locations",
  authenticateUser,
  // sales_manager reads branches to filter sold packages by branch.
  authorizeUser(["management", "branch_admin", "accountant", "sales_manager"]),
  adminRead(REF, CacheTags.locations),
  getLocation
);
adminRoutes.post(
  "/locations",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.locations]),
  addLocation
);
adminRoutes.patch(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.locations]),
  updateLocation
);
adminRoutes.delete(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.locations]),
  deleteLocation
);

adminRoutes.get(
  "/payments/pin",
  authenticateUser,
  authorizeUser(["management"]),
  getPaymentsPin
);
adminRoutes.put(
  "/payments/pin",
  authenticateUser,
  authorizeUser(["management"]),
  updatePaymentsPin
);
adminRoutes.post(
  "/payments/verify-pin",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  verifyPaymentsPin
);

adminRoutes.get(
  "/payments",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  adminRead(LIST, CacheTags.payments),
  getPayments
);
adminRoutes.patch(
  "/payments/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.payments, CacheTags.finance]),
  bustFinanceCache,
  updatePayment
);
adminRoutes.delete(
  "/payments/:id",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.payments, CacheTags.finance]),
  bustFinanceCache,
  deletePayment
);
adminRoutes.post(
  "/payments/:id/sync-coachera",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.payments]),
  syncPaymentToCoachera
);

// Refund Routes
adminRoutes.post(
  "/refunds/member",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.refunds, CacheTags.payments, CacheTags.finance]),
  bustFinanceCache,
  createMemberRefund
);
adminRoutes.post(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.refunds, CacheTags.payments, CacheTags.finance]),
  bustFinanceCache,
  createCashOut
);
adminRoutes.get(
  "/refunds",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.refunds),
  getRefundByPaymentId
);
adminRoutes.get(
  "/refunds/list",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.refunds),
  listRefunds
);
adminRoutes.get(
  "/refunds/cashouts",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.refunds),
  listCashOuts
);
adminRoutes.get(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.refunds),
  listCashOuts
);

// Member Search Route
adminRoutes.get(
  "/members/search",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.members),
  searchMembers
);
adminRoutes.get(
  "/members/export",
  authenticateUser,
  authorizeUser(["management", "branch_admin", "accountant"]),
  // Tag both: export reads User fields; /users writes only bust CacheTags.users.
  adminRead(HOT, CacheTags.members, CacheTags.users),
  exportMembers
);
adminRoutes.get(
  "/members/:memberId/recent-payments",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.payments, CacheTags.members),
  getMemberRecentPayments
);

// Products Routes\
adminRoutes.get(
  "/products",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(REF, CacheTags.products),
  getProducts
);

adminRoutes.post(
  "/product",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.products]),
  addProduct
);

adminRoutes.patch(
  "/products/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.products]),
  editProduct
);

adminRoutes.delete(
  "/product/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.products]),
  deleteProduct
);

// Orders Routes
adminRoutes.get(
  "/orders",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(LIST, CacheTags.orders),
  getOrders
);

adminRoutes.post(
  "/orders",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.orders, CacheTags.products]),
  createOrder
);

adminRoutes.delete(
  "/orders/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.orders, CacheTags.products]),
  deleteOrder
);

// Ticket Routes
adminRoutes.get(
  "/tickets",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(HOT, CacheTags.tickets),
  getTickets
);
adminRoutes.post(
  "/tickets",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.tickets]),
  submitTicket
);
adminRoutes.patch(
  "/tickets/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  invalidateCache([CacheTags.tickets]),
  updateTicketStatus
);

// Ticket Category Routes (admin-editable problem list)
adminRoutes.get(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adminRead(REF, CacheTags.ticketCategories),
  getTicketCategories
);
adminRoutes.post(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.ticketCategories]),
  addTicketCategory
);
adminRoutes.patch(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.ticketCategories]),
  updateTicketCategory
);
adminRoutes.delete(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.ticketCategories]),
  deleteTicketCategory
);
// Mail System Routes
adminRoutes.post(
  "/mail/send",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer"]),
  invalidateCache([CacheTags.mail]),
  sendMail
);

adminRoutes.get(
  "/mail/logs",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer", "accountant"]),
  adminRead(SHORT, CacheTags.mail),
  getLogs
);

adminRoutes.get(
  "/mail/inbox",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer", "accountant"]),
  adminRead(SHORT, CacheTags.mail),
  getInbox
);

adminRoutes.get(
  "/mail/profile",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer", "accountant"]),
  adminRead(SHORT, CacheTags.mail),
  getMailProfile
);

adminRoutes.post(
  "/mail/sync",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer"]),
  invalidateCache([CacheTags.mail]),
  triggerSync
);

adminRoutes.get(
  "/mail/unread-count",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer"]),
  adminRead(SHORT, CacheTags.mail),
  getUnreadCount
);

adminRoutes.patch(
  "/mail/read-all",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer"]),
  invalidateCache([CacheTags.mail]),
  markAllEmailsRead
);

adminRoutes.patch(
  "/mail/:id/read",
  authenticateUser,
  authorizeUser(["management", "managing_coach", "mailer"]),
  invalidateCache([CacheTags.mail]),
  markEmailAsRead
);

// Daily Sheet Routes
adminRoutes.get(
  "/sheet",
  authenticateUser,
  authorizeUser(["management", "accountant"]),
  adminRead(HOT, CacheTags.sheet),
  getSheetDay
);

adminRoutes.get(
  "/sheet/member-eligibility",
  authenticateUser,
  authorizeUser(["management", "accountant"]),
  adminRead(HOT, CacheTags.sheet, CacheTags.members),
  getSheetMemberEligibility
);

adminRoutes.post(
  "/sheet/commit",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.sheet, CacheTags.members, CacheTags.payments]),
  commitSheetRows
);

adminRoutes.post(
  "/sheet/import",
  authenticateUser,
  authorizeUser(["management"]),
  invalidateCache([CacheTags.sheet]),
  importSheetDay
);

// Space Maintenance Checklist Routes
adminRoutes.get(
  "/maintenance/current",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getCurrentHourSlot
);

adminRoutes.post(
  "/maintenance/check",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  updateChecklistItem
);

adminRoutes.post(
  "/maintenance/batch-submit",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  batchUpdateChecklist
);

adminRoutes.get(
  "/maintenance/overview",
  authenticateUser,
  authorizeUser(["management"]),
  getManagementOverview
);

adminRoutes.get(
  "/maintenance/history",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getMaintenanceHistory
);

// PT Achievement / PT Reports (management staff; separate from finance PT Analytics)
adminRoutes.get(
  "/pt-achievement",
  authenticateUser,
  authorizeUser(["management"]),
  adminRead(45_000, CacheTags.ptAchievement),
  getPtAchievementReport
);

export default adminRoutes;
