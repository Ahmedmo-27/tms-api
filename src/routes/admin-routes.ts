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
  listOpenGymDropInPrices,
  setOpenGymDropInPrice,
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
import { sendMail, getLogs, getInbox } from "../controllers/admin/mail-controller";

const adminRoutes = express.Router();

// Member Routes
adminRoutes.get(
  "/member",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getMember
);
adminRoutes.post(
  "/member/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addMember
);
adminRoutes.get(
  "/pending-members",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getPendingMembers
);

// Scheduling Routes
adminRoutes.get(
  "/schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getScheduledClasses
);
adminRoutes.get(
  "/next-schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getNextScheduledClasses
);
adminRoutes.post(
  "/schedule",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  scheduleClass
);
adminRoutes.delete(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  cancelClass
);
adminRoutes.patch(
  "/schedule/:scid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  editClass
);
adminRoutes.get(
  "/daily-attendance",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getDailyAttendnace
);
adminRoutes.get(
  "/attendance",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getAttendanceHistory
);

// Class CRUD Routes
adminRoutes.get(
  "/class",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getClass
);
adminRoutes.post(
  "/class",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addClass
);
adminRoutes.patch(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  updateClass
);
adminRoutes.delete(
  "/class/:cid",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  deleteClass
);

// Booking Routes
adminRoutes.get(
  "/bookings",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getMemberBookings
);
adminRoutes.post(
  "/book",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  bookClass
);
adminRoutes.delete(
  "/cancel",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  cancelBooking
);

adminRoutes.get(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getWaitlistedMembers
);

adminRoutes.post(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  overrideAddToWaitlist
);

adminRoutes.delete(
  "/bookings/waitlist",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  overrideRemoveFromWaitlist
);

adminRoutes.post(
  "/bookings/waitlist/promote",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  promoteFromWaitlist
);

adminRoutes.post(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  manualRecordMemberAttendance
);

adminRoutes.delete(
  "/attendance/manual",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  manualRemoveMemberAttendance
);

adminRoutes.post(
  "/bookDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  bookDropIn
);

adminRoutes.get(
  "/openGym/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getOpenGymDropInPrice
);

adminRoutes.get(
  "/openGym/dropInPrices",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  listOpenGymDropInPrices
);

adminRoutes.patch(
  "/openGym/dropInPrice",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  setOpenGymDropInPrice
);

adminRoutes.post(
  "/openGym/memberDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  recordOpenGymMemberDropIn
);

adminRoutes.post(
  "/openGym/guestDropIn",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  recordOpenGymGuestDropIn
);

adminRoutes.get(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getNonUserBookings
)

adminRoutes.post(
  "/nonUserBooking",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  bookNonUser
)

adminRoutes.post(
  "/nonUserBooking/attend",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  recordNonUserAttendance
)

adminRoutes.post(
  "/nonUserBooking/pay",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  saveNonUserPayment
)

adminRoutes.post(
  "/nonUserBooking/cancel/:bookingId",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  cancelNonUserBooking
)

adminRoutes.post(
  "/nonUserBooking/walk-in",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addWalkIn
)

adminRoutes.post(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addNonUserPackage
)

adminRoutes.get(
  "/nonUserPackage",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getNonUserPackages
)

// Packages CRUD Routes
adminRoutes.get(
  "/packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getPackage
);
adminRoutes.post(
  "/packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addPackage
);
adminRoutes.delete(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  deletePackage
);
adminRoutes.patch(
  "/packages/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  updatePackage
);

// Member Packages Routes
adminRoutes.post(
  "/member-packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  subMemberToPackage
);
adminRoutes.delete(
  "/member-packages",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  unsubMemberFromPackage
);
adminRoutes.patch(
  "/member-packages/edit",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  editMemberPackage
);
adminRoutes.patch(
  "/member-packages/adjust",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  adjustMemberPackageClasses
);

// Notification Routes
adminRoutes.post(
  "/send-message",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  sendCustomNotification
);

// Coach Management Routes
adminRoutes.get(
  "/coaches",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getCoaches
);
adminRoutes.post(
  "/coaches",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addCoach
);
adminRoutes.patch(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  updateCoach
);
adminRoutes.delete(
  "/coaches/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  deleteCoach
);

// Location Routes
adminRoutes.get(
  "/locations",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getLocation
);
adminRoutes.post(
  "/locations",
  authenticateUser,
  authorizeUser(["management"]),
  addLocation
);
adminRoutes.patch(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["management"]),
  updateLocation
);
adminRoutes.delete(
  "/locations/:id",
  authenticateUser,
  authorizeUser(["management"]),
  deleteLocation
);

adminRoutes.get(
  "/payments",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getPayments
);

// Refund Routes
adminRoutes.post(
  "/refunds/member",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  createMemberRefund
);
adminRoutes.post(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  createCashOut
);
adminRoutes.get(
  "/refunds",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getRefundByPaymentId
);
adminRoutes.get(
  "/refunds/list",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  listRefunds
);
adminRoutes.get(
  "/refunds/cashouts",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  listCashOuts
);
adminRoutes.get(
  "/refunds/cashout",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  listCashOuts
);

// Member Search Route
adminRoutes.get(
  "/members/search",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  searchMembers
);
adminRoutes.get(
  "/members/:memberId/recent-payments",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getMemberRecentPayments
);

// Products Routes\
adminRoutes.get(
  "/products",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getProducts
);

adminRoutes.post(
  "/product",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  addProduct
);

adminRoutes.patch(
  "/products/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  editProduct
);

adminRoutes.delete(
  "/product/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  deleteProduct
);

// Orders Routes
adminRoutes.get(
  "/orders",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getOrders
);

adminRoutes.post(
  "/orders",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  createOrder
);

adminRoutes.delete(
  "/orders/:barcode",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  deleteOrder
);

// Ticket Routes
adminRoutes.get(
  "/tickets",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getTickets
);
adminRoutes.post(
  "/tickets",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  submitTicket
);
adminRoutes.patch(
  "/tickets/:id",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  updateTicketStatus
);

// Ticket Category Routes (admin-editable problem list)
adminRoutes.get(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["management", "branch_admin"]),
  getTicketCategories
);
adminRoutes.post(
  "/ticket-categories",
  authenticateUser,
  authorizeUser(["management"]),
  addTicketCategory
);
adminRoutes.patch(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["management"]),
  updateTicketCategory
);
adminRoutes.delete(
  "/ticket-categories/:id",
  authenticateUser,
  authorizeUser(["management"]),
  deleteTicketCategory
);
// Mail System Routes
adminRoutes.post(
  "/mail/send",
  authenticateUser,
  authorizeUser(["management"]),
  sendMail
);

adminRoutes.get(
  "/mail/logs",
  authenticateUser,
  authorizeUser(["management"]),
  getLogs
);

adminRoutes.get(
  "/mail/inbox",
  authenticateUser,
  authorizeUser(["management"]),
  getInbox
);

export default adminRoutes;
