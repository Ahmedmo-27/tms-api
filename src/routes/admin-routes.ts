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
  recordOpenGymMemberDropIn,
  recordOpenGymGuestDropIn,
  bookNonUser,
  getNonUserBookings,
  recordNonUserAttendance,
  cancelNonUserBooking,
  addWalkIn,
  saveNonUserPayment,
  manualRecordMemberAttendance,
  manualRemoveMemberAttendance,
  overrideAddToWaitlist,
  overrideRemoveFromWaitlist,
  getWaitlistedMembers,
  promoteFromWaitlist,
} from "../controllers/admin/class-controller";
import {
  addPackage,
  getPackage,
  deletePackage,
  updatePackage,
  subMemberToPackage,
  unsubMemberFromPackage,
  editMemberPackage,
  adjustMemberPackageClasses,
  addNonUserPackage,
  getNonUserPackages,
} from "../controllers/admin/package-controller";
import {
  addCoach,
  getCoaches,
  updateCoach,
  deleteCoach,
} from "../controllers/admin/coach-controller";
import { addMember, getMember } from "../controllers/admin/member-controller";
import { getAttendanceHistory } from "../controllers/admin/attendance-controller";
import { getPendingMembers } from "../controllers/admin/user-contoller";
import { sendCustomNotification } from "../controllers/admin/notifications-controller";
import {
  addLocation,
  getLocation,
  updateLocation,
  deleteLocation,
} from "../controllers/admin/location-controller";
import { getPayments } from "../controllers/admin/payments-controller";
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
import { sendMail, getLogs, getInbox } from "../controllers/admin/mail-controller";

const adminRoutes = express.Router();

// Member Routes
adminRoutes.get(
  "/member",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getMember
);
adminRoutes.post(
  "/member/:id",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  addMember
);
adminRoutes.get(
  "/pending-members",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getPendingMembers
);

// Scheduling Routes
adminRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getScheduledClasses
);
adminRoutes.get(
  "/next-schedule",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getNextScheduledClasses
);
adminRoutes.post(
  "/schedule",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  scheduleClass
);
adminRoutes.delete(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  cancelClass
);
adminRoutes.patch(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  editClass
);
adminRoutes.get(
  "/daily-attendance",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getDailyAttendnace
);
adminRoutes.get(
  "/attendance",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getAttendanceHistory
);

// Class CRUD Routes
adminRoutes.get(
  "/class",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getClass
);
adminRoutes.post(
  "/class",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  addClass
);
adminRoutes.patch(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["admin"]),
  updateClass
);
adminRoutes.delete(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteClass
);

// Booking Routes
adminRoutes.get(
  "/bookings",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getMemberBookings
);
adminRoutes.post(
  "/book",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  bookClass
);
adminRoutes.delete(
  "/cancel",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  cancelBooking
);

adminRoutes.get(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getWaitlistedMembers
);

adminRoutes.post(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  overrideAddToWaitlist
);

adminRoutes.delete(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  overrideRemoveFromWaitlist
);

adminRoutes.post(
  "/bookings/waitlist/promote",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  promoteFromWaitlist
);

adminRoutes.post(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  manualRecordMemberAttendance
);

adminRoutes.delete(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  manualRemoveMemberAttendance
);

adminRoutes.post(
  "/bookDropIn",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  bookDropIn
);

adminRoutes.get(
  "/openGym/dropInPrice",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getOpenGymDropInPrice
);

adminRoutes.post(
  "/openGym/memberDropIn",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  recordOpenGymMemberDropIn
);

adminRoutes.post(
  "/openGym/guestDropIn",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  recordOpenGymGuestDropIn
);

adminRoutes.get(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getNonUserBookings
)

adminRoutes.post(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  bookNonUser
)

adminRoutes.post(
  "/nonUserBooking/attend",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  recordNonUserAttendance
)

adminRoutes.post(
  "/nonUserBooking/pay",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  saveNonUserPayment
)

adminRoutes.post(
  "/nonUserBooking/cancel/:bookingId",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  cancelNonUserBooking
)

adminRoutes.post(
  "/nonUserBooking/walk-in",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  addWalkIn
)

adminRoutes.post(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  addNonUserPackage
)

adminRoutes.get(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getNonUserPackages
)

// Packages CRUD Routes
adminRoutes.get(
  "/packages",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getPackage
);
adminRoutes.post(
  "/packages",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  addPackage
);
adminRoutes.delete(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  deletePackage
);
adminRoutes.patch(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  updatePackage
);

// Member Packages Routes
adminRoutes.post(
  "/member-packages",
  authenticateUser,
  authorizeUser(["admin"]),
  subMemberToPackage
);
adminRoutes.delete(
  "/member-packages",
  authenticateUser,
  authorizeUser(["admin"]),
  unsubMemberFromPackage
);
adminRoutes.patch(
  "/member-packages/edit",
  authenticateUser,
  authorizeUser(["admin"]),
  editMemberPackage
);
adminRoutes.patch(
  "/member-packages/adjust",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  adjustMemberPackageClasses
);

// Notification Routes
adminRoutes.post(
  "/send-message",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  sendCustomNotification
);

// Coach Management Routes
adminRoutes.get(
  "/coaches",
  authenticateUser,
  authorizeUser(["admin"]),
  getCoaches
);
adminRoutes.post(
  "/coaches",
  authenticateUser,
  authorizeUser(["admin"]),
  addCoach
);
adminRoutes.patch(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  updateCoach
);
adminRoutes.delete(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteCoach
);

// Location Routes
adminRoutes.get(
  "/locations",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getLocation
);
adminRoutes.post(
  "/locations",
  authenticateUser,
  authorizeUser(["admin"]),
  addLocation
);
adminRoutes.patch(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  updateLocation
);
adminRoutes.delete(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteLocation
);

adminRoutes.get(
  "/payments",
  authenticateUser,
  authorizeUser(["admin"]),
  getPayments
);

// Refund Routes
adminRoutes.post(
  "/refunds/member",
  authenticateUser,
  authorizeUser(["admin"]),
  createMemberRefund
);
adminRoutes.post(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["admin"]),
  createCashOut
);
adminRoutes.get(
  "/refunds",
  authenticateUser,
  authorizeUser(["admin"]),
  getRefundByPaymentId
);
adminRoutes.get(
  "/refunds/list",
  authenticateUser,
  authorizeUser(["admin"]),
  listRefunds
);
adminRoutes.get(
  "/refunds/cashouts",
  authenticateUser,
  authorizeUser(["admin"]),
  listCashOuts
);
adminRoutes.get(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["admin"]),
  listCashOuts
);

// Member Search Route
adminRoutes.get(
  "/members/search",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  searchMembers
);
adminRoutes.get(
  "/members/:memberId/recent-payments",
  authenticateUser,
  authorizeUser(["admin"]),
  getMemberRecentPayments
);

// Products Routes\
adminRoutes.get(
  "/products",
  authenticateUser,
  authorizeUser(["admin"]),
  getProducts
);

adminRoutes.post(
  "/product",
  authenticateUser,
  authorizeUser(["admin"]),
  addProduct
);

adminRoutes.patch(
  "/products/:barcode",
  authenticateUser,
  authorizeUser(["admin"]),
  editProduct
);

adminRoutes.delete(
  "/product/:barcode",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteProduct
);

// Orders Routes
adminRoutes.get(
  "/orders",
  authenticateUser,
  authorizeUser(["admin"]),
  getOrders
);

adminRoutes.post(
  "/orders",
  authenticateUser,
  authorizeUser(["admin"]),
  createOrder
);

adminRoutes.delete(
  "/orders/:barcode",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteOrder
);

// Ticket Routes
adminRoutes.get(
  "/tickets",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getTickets
);
adminRoutes.patch(
  "/tickets/:id",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  updateTicketStatus
);

// Ticket Category Routes (admin-editable problem list)
adminRoutes.get(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["admin", "fd"]),
  getTicketCategories
);
adminRoutes.post(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["admin"]),
  addTicketCategory
);
adminRoutes.patch(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  updateTicketCategory
);
adminRoutes.delete(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["admin"]),
  deleteTicketCategory
);
// Mail System Routes
adminRoutes.post(
  "/mail/send",
  authenticateUser,
  authorizeUser(["admin"]),
  sendMail
);

adminRoutes.get(
  "/mail/logs",
  authenticateUser,
  authorizeUser(["admin"]),
  getLogs
);

adminRoutes.get(
  "/mail/inbox",
  authenticateUser,
  authorizeUser(["admin"]),
  getInbox
);

export default adminRoutes;
