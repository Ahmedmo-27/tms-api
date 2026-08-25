# TMS API — Complete Technical Documentation

REST API backend for **The Mind Space (TMS)** gym management and fitness community platform.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture & Request Lifecycle](#3-architecture--request-lifecycle)
4. [Environment Configuration](#4-environment-configuration)
5. [Authentication & Authorization (RBAC)](#5-authentication--authorization-rbac)
6. [Rate Limiting](#6-rate-limiting)
7. [Error Handling & Response Standard](#7-error-handling--response-standard)
8. [API Route Reference](#8-api-route-reference)
   - [8.1 Authentication Routes (`/auth`)](#81-authentication-routes-auth)
   - [8.2 Admin & Management Routes (`/admin`)](#82-admin--management-routes-admin)
   - [8.3 Coach Portal Routes (`/coach`)](#83-coach-portal-routes-coach)
   - [8.4 Member Client Routes (`/member`)](#84-member-client-routes-member)
   - [8.5 Wellness Challenge Routes (`/challenge`)](#85-wellness-challenge-routes-challenge)
   - [8.6 Social Feed Routes (`/feed`)](#86-social-feed-routes-feed)
   - [8.7 Exposed / Public Routes (`/external`)](#87-exposed--public-routes-external)
9. [Database Models & Schemas](#9-database-models--schemas)
10. [Real-Time WebSocket Engine (Socket.io)](#10-real-time-websocket-engine-socketio)
11. [Services Layer](#11-services-layer)
12. [Maintenance Scripts & Seeders](#12-maintenance-scripts--seeders)
13. [Testing & Quality Assurance](#13-testing--quality-assurance)

---

## 1. Project Overview

The **TMS API** is an enterprise-grade Express.js REST API written in TypeScript. It serves as the single source of truth and business logic engine for:
- **Web Dashboard**: Multi-branch operational console for Management, Branch Admins, and Front-Desk staff.
- **Coach Portal**: Dedicated interface for coaches to track daily personal training schedules, view assigned trainees, manage session balances, and deduct sessions.
- **Mobile Application**: Cross-platform iOS/Android app for gym members to discover classes, purchase packages, manage bookings, check in via dynamic QR codes, track wellness challenges, and interact with the gym community feed.

---

## 2. Tech Stack

| Component | Technology | Version / Spec |
|---|---|---|
| Runtime | Node.js | `>= 20.x` |
| Language | TypeScript | `^5.8.2` |
| Web Framework | Express.js | `^4.21.2` |
| Database | MongoDB | `>= 6.0` via Mongoose `^8.12.1` |
| Real-time WebSockets | Socket.io | `^4.8.3` |
| Authentication | JSON Web Tokens (`jsonwebtoken`) + `bcryptjs` | JWT 30-day multi-device session tracking |
| Push Notifications | Firebase Admin SDK | `^13.4.0` (FCM v1 HTTP) |
| Transactional & Marketing Email | Resend / Brevo (`@getbrevo/brevo`) | `^6.0.2` / `^5.0.4` |
| Inbound Email Sync | `imap-simple` + `mailparser` | Gmail IMAP worker |
| Structured Logging | Winston | `^3.17.0` |
| API Documentation | Swagger (OpenAPI 3.0) | `swagger-jsdoc` + `swagger-ui-express` |
| Rate Limiting | `express-rate-limit` | Memory store per-IP windowing |
| Testing | Jest + Supertest + MongoDB Memory Server | `ts-jest ^29.3.0` |

---

## 3. Architecture & Request Lifecycle

```mermaid
flowchart TD
    Client[Client: Web / Coach Portal / Mobile App] -->|HTTP Request / WebSocket| Entry[Express App Entry: src/app.ts]
    Entry --> CORS[CORS Whitelist & Cookie Parser]
    CORS --> RateLimit[Rate Limiters: Default / Login / ResetPassword]
    RateLimit --> Logger[Winston HTTP Request Logger]
    Logger --> Router[API Router: src/routes/index.ts]
    
    Router --> AuthMid[Auth Middleware: authenticateUser]
    AuthMid --> RoleMid[Role Guard: authorizeUser / coachGuard / challengeGate]
    RoleMid --> Controller[Controller Function wrapped in asyncHandler]
    
    Controller --> Services[Business Services: Bookings, Subscriptions, Payments, Sheet, Email]
    Services --> DB[(MongoDB Database via Mongoose)]
    Services --> Sockets[Socket.io Broadcast: SUCCESS-SCAN / FAILED-SCAN]
    Services --> FCM[Firebase Cloud Messaging Engine]
    Services --> Mailer[Brevo / Resend Mail API]
    
    Controller -->|Success| SuccessResp[SuccessResponse.send 200/201]
    Controller -->|Throws ApiError| ErrMid[Global Error Middleware: ApiError.handle]
    ErrMid --> ErrorResp[Standardized JSON Error Payload]
```

### Key Design Patterns:
- **`asyncHandler` Wrapper**: Eliminates boilerplate `try/catch` across all controller methods; uncaught rejections bubble directly to `ApiError.handle`.
- **Typed `ApiError` Hierarchy**: Custom error classes carry numeric HTTP status codes and domain-specific machine codes (`MEMBER_NOT_FOUND`, `PACKAGE_EXPIRED`, `CLASS_FULL`).
- **MongoDB Multi-Document Transactions**: High-stakes workflows (class reservations, package subscription deductions, refunds) execute inside atomic `ClientSession` transactions.
- **Injected Socket.io Singleton**: Express app sets `app.set("io", io)`, which controllers read via `req.app.get("io")` to emit real-time updates across front-desk monitors.

---

## 4. Environment Configuration

The API reads configuration from `dev.env` in local development and standard environment variables in production.

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/tms?retryWrites=true&w=majority

# Security & JWT
JWT_SECRET=your_super_secret_jwt_key_here

# Outbound Email (Resend - System/Password Reset)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_USER=support@themindspace.com

# Outbound Email (Brevo - Dashboard Communications)
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxx
MAIL_FROM_NAME="The Mind Space"
MAIL_FROM_ADDRESS=notifications@themindspace.com

# Inbound Email Synchronization (Gmail IMAP)
MAIL_USER=gym.inbox@gmail.com
MAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Firebase Service Account (Push Notifications)
FIREBASE_PROJECT_ID=the-mind-space
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@the-mind-space.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## 5. Authentication & Authorization (RBAC)

### 5.1 Dual Token Transport

| Client Platform | Header / Transport | Request Context `deviceType` |
|---|---|---|
| **Web Dashboard** | `Cookie: token=<jwt>` (HttpOnly, SameSite) | `"web"` |
| **Mobile App & API Clients** | `Authorization: Bearer <jwt>` | `"mobile"` |

### 5.2 JWT Token Payload
```json
{
  "uid": "65e6d2b512a4b891c9812401",
  "role": "management",
  "deviceType": "web",
  "jti": "d3b07384-d113-4a44-9c81-9251512c12a8",
  "iat": 1740490000
}
```

Tokens expire in **30 days**. The `User` model stores an array of active tokens (`tokens: [{ token, device, expiresIn }]`), enabling granular single-device logout (`/auth/logout`) and global session termination (`/auth/logout-all`).

### 5.3 Role Permission Matrix

| Role | Scope | Key Capabilities |
|---|---|---|
| `management` | Global Multi-Branch | Full administrative access, location CRUD, ticket category CRUD, cross-branch analytics, broadcast mailing. |
| `branch_admin` | Single Branch (`locationId`) | Operational control over assigned branch: schedule, attendance, class booking, POS orders, refunds, member packages. |
| `coach` | Assigned Trainees & Classes | View schedule, view assigned clients, inspect package balances, deduct PT sessions, submit coach tickets. |
| `member` | Self-Service | Book classes, join waitlists, buy packages, view attendance, display dynamic QR code, participate in challenges. |
| `user` | Pending Member | Registered mobile user awaiting membership profile creation / approval by front desk. |

---

## 6. Rate Limiting

The API enforces tiered rate limiting using `express-rate-limit`:

| Limiter Name | Window | Max Requests | Scope | Target Routes |
|---|---|---|---|---|
| `defaultLimiter` | 15 Minutes | 100 requests | Per IP | All endpoints by default |
| `loginLimiter` | 5 Minutes | 5 requests | Per IP | `POST /auth/login`, `POST /coach/auth/login` |
| `resetPasswordLimiter` | 1 Hour | 3 requests | Per IP | `POST /auth/reset-password` |
| `resetPasswordGlobalLimiter` | 24 Hours | 495 requests | Shared Global | `POST /auth/reset-password` |

When rate-limited, the API responds with HTTP status `429`:
```json
{
  "statusCode": 429,
  "message": "Too many requests, please try again later.",
  "code": "RATE_LIMITED"
}
```

---

## 7. Error Handling & Response Standard

### 7.1 Success Response Envelope (`SuccessResponse`)
```json
{
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    "id": "65e6d2b512a4b891c9812401",
    "status": "confirmed"
  }
}
```

### 7.2 Error Response Envelope (`ApiError`)
```json
{
  "statusCode": 400,
  "message": "The requested class has reached maximum capacity.",
  "code": "CLASS_FULL"
}
```

### 7.3 Standard Error Codes & Status Mappings

| Error Class | HTTP Status | Typical Error Code |
|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_SCHEDULE_TIME` |
| `AuthFailureError` | 401 | `MISSING_TOKEN`, `AUTH_FAILURE`, `INVALID_CREDENTIALS` |
| `BadTokenError` | 401 | `INVALID_TOKEN`, `TOKEN_REVOKED` |
| `TokenExpiredError` | 401 | `TOKEN_EXPIRED` |
| `ForbiddenError` | 403 | `INSUFFICIENT_PERMISSIONS`, `BRANCH_ACCESS_DENIED` |
| `NotFoundError` | 404 | `MEMBER_NOT_FOUND`, `CLASS_NOT_FOUND`, `PACKAGE_NOT_FOUND` |
| `ConflictError` | 409 | `DUPLICATE_BOOKING`, `ALREADY_CHECKED_IN`, `PHONE_EXISTS` |
| `InternalError` | 500 | `INTERNAL_SERVER_ERROR`, `DATABASE_ERROR`, `PAYMENT_GATEWAY_ERROR` |

---

## 8. API Route Reference

### 8.1 Authentication Routes (`/auth`)

| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `POST` | `/auth/register` | No | — | Register a new mobile user account (`name`, `email`, `password`, `phoneNumber`). |
| `POST` | `/auth/register-manually` | No | — | Manual user registration for front-desk onboarding. |
| `POST` | `/auth/login` | No (Rate-limited) | — | Login with `phoneNumber` + `password`. Sets HttpOnly cookie (web) or returns Bearer token (mobile). |
| `GET` | `/auth` | Yes | `management`, `branch_admin` | Get currently authenticated user profile. |
| `GET` | `/auth/verifyToken` | Yes | `management`, `branch_admin`, `coach` | Validates session token and returns user details. |
| `GET` | `/auth/logout` | Yes | Any | Invalidates token for current device. |
| `GET` | `/auth/logout-all` | Yes | Any | Invalidates all active tokens across all devices. |
| `POST` | `/auth/reset-password` | No (Rate-limited) | — | Generates and emails a 6-digit password reset code. |
| `POST` | `/auth/confirm-password-reset` | No | — | Validates 6-digit code and applies new password. |
| `DELETE` | `/auth` | Yes | `management`, `member` | Soft delete / deactivate user account. |

---

### 8.2 Admin & Management Routes (`/admin`)

#### Member Management
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/member` | `management`, `branch_admin` | Search and filter registered members. Supports pagination and name/phone search. |
| `POST` | `/admin/member/:id` | `management`, `branch_admin` | Promote a user (`role: user`) to a full `member` with membership profile. |
| `GET` | `/admin/pending-members` | `management`, `branch_admin` | List all users pending membership approval. |
| `GET` | `/admin/members/search` | `management`, `branch_admin` | Fast fuzzy search for members by phone number or name. |
| `GET` | `/admin/members/:memberId/recent-payments` | `management`, `branch_admin` | Fetch recent payment and order history for a member. |

#### Scheduling & Class Operations
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/schedule` | `management`, `branch_admin` | List scheduled class instances for a date range and location. |
| `GET` | `/admin/next-schedule` | `management`, `branch_admin` | Fetch upcoming scheduled sessions. |
| `POST` | `/admin/schedule` | `management`, `branch_admin` | Schedule a new class session (class type, coach, location, time, capacity). |
| `PATCH` | `/admin/schedule/:scid` | `management`, `branch_admin` | Update scheduled class parameters (coach, room, time, max capacity). |
| `DELETE` | `/admin/schedule/:scid` | `management`, `branch_admin` | Cancel scheduled class and notify booked members. |
| `GET` | `/admin/daily-attendance` | `management`, `branch_admin` | Get real-time attendance matrix for the current day. |
| `GET` | `/admin/attendance` | `management`, `branch_admin` | Historical attendance report filtered by date/branch. |
| `POST` | `/admin/attendance/manual` | `management`, `branch_admin` | Manually mark a member as attended for a class. |
| `DELETE` | `/admin/attendance/manual` | `management`, `branch_admin` | Revert a manual attendance mark. |
| `DELETE` | `/admin/attendance/failed-scan` | `management`, `branch_admin` | Dismiss a failed scan alert on the front desk monitor. |

#### Waitlist Management
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/bookings/waitlist` | `management`, `branch_admin` | Get members on the waitlist for a specific scheduled class. |
| `POST` | `/admin/bookings/waitlist` | `management`, `branch_admin` | Admin override: Add member to class waitlist. |
| `DELETE` | `/admin/bookings/waitlist` | `management`, `branch_admin` | Admin override: Remove member from class waitlist. |
| `POST` | `/admin/bookings/waitlist/promote` | `management`, `branch_admin` | Manually promote a waitlisted member into a confirmed booking. |

#### Class Catalog (CRUD)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/class` | `management`, `branch_admin` | List all class catalog templates. |
| `POST` | `/admin/class` | `management`, `branch_admin` | Create a new class type (title, category, duration, description, intensity). |
| `PATCH` | `/admin/class/:cid` | `management`, `branch_admin` | Edit class definition. |
| `DELETE` | `/admin/class/:cid` | `management`, `branch_admin` | Soft delete / deprecate class template. |

#### Bookings & Drop-ins
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/bookings` | `management`, `branch_admin` | Get bookings list for a specific member or class. |
| `POST` | `/admin/book` | `management`, `branch_admin` | Book a registered member into a scheduled class. |
| `DELETE` | `/admin/cancel` | `management`, `branch_admin` | Cancel a member's booking and restore their package session credit. |
| `POST` | `/admin/bookDropIn` | `management`, `branch_admin` | Record a drop-in booking without deducting package credits. |
| `GET` | `/admin/openGym/dropInPrice` | `management`, `branch_admin` | Get active open-gym drop-in rate. |
| `GET` | `/admin/openGym/dropInPrices` | `management`, `branch_admin` | List location-specific open gym drop-in rates. |
| `PATCH` | `/admin/openGym/dropInPrice` | `management`, `branch_admin` | Set open gym drop-in price for a branch. |
| `POST` | `/admin/openGym/memberDropIn` | `management`, `branch_admin` | Check-in a registered member for Open Gym. |
| `POST` | `/admin/openGym/guestDropIn` | `management`, `branch_admin` | Check-in an unregistered guest for Open Gym. |

#### Non-User & Guest Operations
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/nonUserBooking` | `management`, `branch_admin` | List non-user guest bookings. |
| `POST` | `/admin/nonUserBooking` | `management`, `branch_admin` | Create a guest booking (name, phone, class). |
| `POST` | `/admin/nonUserBooking/attend` | `management`, `branch_admin` | Mark non-user guest as attended. |
| `POST` | `/admin/nonUserBooking/pay` | `management`, `branch_admin` | Record cash/card payment for non-user guest. |
| `POST` | `/admin/nonUserBooking/cancel/:bookingId` | `management`, `branch_admin` | Cancel non-user booking. |
| `PATCH` | `/admin/nonUserBooking/:bookingId/phone` | `management`, `branch_admin` | Update non-user phone number. |
| `POST` | `/admin/nonUserBooking/walk-in` | `management`, `branch_admin` | Create an instant walk-in guest booking. |
| `POST` | `/admin/nonUserPackage` | `management`, `branch_admin` | Sell a package to a non-registered guest. |
| `GET` | `/admin/nonUserPackage` | `management`, `branch_admin` | List guest packages. |

#### Packages & Subscriptions
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/packages` | `management`, `branch_admin` | List all package definitions. |
| `POST` | `/admin/packages` | `management`, `branch_admin` | Create a new package (price, sessions, duration, type, branch access). |
| `GET` | `/admin/packages/:id/deletion-impact` | `management`, `branch_admin` | Safety report showing active subscribers before package deletion. |
| `PATCH` | `/admin/packages/:id` | `management`, `branch_admin` | Update package details. |
| `DELETE` | `/admin/packages/:id` | `management`, `branch_admin` | Delete or archive package. |
| `POST` | `/admin/member-packages` | `management`, `branch_admin` | Subscribe a member to a package manually. |
| `DELETE` | `/admin/member-packages` | `management`, `branch_admin` | Unsubscribe member and revoke remaining sessions. |
| `PATCH` | `/admin/member-packages/edit` | `management`, `branch_admin` | Adjust member's expiration date or remaining session count. |
| `PATCH` | `/admin/member-packages/adjust` | `management`, `branch_admin` | Manually adjust class credits on a member package. |

#### Financials, Payments & Refunds
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/payments` | `management`, `branch_admin` | List payment transaction records (filters: branch, method, date). |
| `POST` | `/admin/refunds/member` | `management`, `branch_admin` | Issue a refund to a member and reverse package sessions/orders. |
| `POST` | `/admin/refunds/cashout` | `management`, `branch_admin` | Record an authorized front-desk cash payout. |
| `GET` | `/admin/refunds` | `management`, `branch_admin` | Fetch refund details for a payment ID. |
| `GET` | `/admin/refunds/list` | `management`, `branch_admin` | List all processed refunds. |
| `GET` | `/admin/refunds/cashouts` | `management`, `branch_admin` | List all recorded cash-out logs. |

#### Retail POS & Products
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/products` | `management`, `branch_admin` | List inventory products with barcodes, prices, stock. |
| `POST` | `/admin/product` | `management`, `branch_admin` | Add a new product to retail inventory. |
| `PATCH` | `/admin/products/:barcode` | `management`, `branch_admin` | Update product price, stock, or title. |
| `DELETE` | `/admin/product/:barcode` | `management`, `branch_admin` | Delete retail product from inventory. |
| `GET` | `/admin/orders` | `management`, `branch_admin` | List completed POS orders. |
| `POST` | `/admin/orders` | `management`, `branch_admin` | Checkout a POS order (products, quantity, total, payment method). |
| `DELETE` | `/admin/orders/:barcode` | `management`, `branch_admin` | Void/delete order. |

#### Support Tickets & Categories
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/tickets` | `management`, `branch_admin` | List all open, in-progress, and resolved support tickets. |
| `POST` | `/admin/tickets` | `management`, `branch_admin` | Submit an internal administrative ticket. |
| `PATCH` | `/admin/tickets/:id` | `management`, `branch_admin` | Update ticket status (`open`, `in_progress`, `resolved`, `closed`). |
| `GET` | `/admin/ticket-categories` | `management`, `branch_admin` | List customizable ticket problem categories. |
| `POST` | `/admin/ticket-categories` | `management` | Create a new ticket category. |
| `PATCH` | `/admin/ticket-categories/:id` | `management` | Update a ticket category. |
| `DELETE` | `/admin/ticket-categories/:id` | `management` | Deactivate/delete a ticket category. |

#### Locations & Coaches Management
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/locations` | `management`, `branch_admin` | List all gym branches. |
| `POST` | `/admin/locations` | `management` | Create a new branch location. |
| `PATCH` | `/admin/locations/:id` | `management` | Update branch name, address, coordinates. |
| `DELETE` | `/admin/locations/:id` | `management` | Remove branch location. |
| `GET` | `/admin/coaches` | `management`, `branch_admin` | List all coaches. |
| `POST` | `/admin/coaches` | `management`, `branch_admin` | Add a new coach profile. |
| `PATCH` | `/admin/coaches/:id` | `management`, `branch_admin` | Update coach specialties, bio, picture. |
| `DELETE` | `/admin/coaches/:id` | `management`, `branch_admin` | Delete coach profile. |

#### Communications & Daily Sheet Operations
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `POST` | `/admin/send-message` | `management`, `branch_admin` | Send targeted FCM push notification to specific users. |
| `POST` | `/admin/mail/send` | `management` | Send rich HTML marketing or announcement email via Brevo. |
| `GET` | `/admin/mail/logs` | `management` | View outbound email delivery logs. |
| `GET` | `/admin/mail/inbox` | `management` | Fetch inbound emails synced from gym Gmail account via IMAP. |
| `GET` | `/admin/sheet` | `management`, `branch_admin` | Fetch the calculated daily member operations sheet. |
| `GET` | `/admin/sheet/member-eligibility` | `management`, `branch_admin` | Validate real-time package eligibility for sheet members. |
| `POST` | `/admin/sheet/commit` | `management`, `branch_admin` | Commit daily sheet rows into attendance logs. |
| `POST` | `/admin/sheet/import` | `management`, `branch_admin` | Upload and import historical Excel daily sheet. |

---

### 8.3 Coach Portal Routes (`/coach`)

| Method | Endpoint | Auth / Guard | Description |
|---|---|---|---|
| `POST` | `/coach/auth/login` | Rate-limited | Coach login via email/phone and password. |
| `GET` | `/coach/auth/verifyToken` | `authenticateUser` + `coach` | Validate coach JWT session. |
| `POST` | `/coach/auth/change-password` | `coachGuard` | Change coach password. |
| `GET` | `/coach/me` | `coachGuard` | Get current coach profile and stats. |
| `GET` | `/coach/today` | `coachGuard` | Daily PT sessions and class overview for today. |
| `GET` | `/coach/notifications` | `coachGuard` | Get coach notification feed. |
| `PATCH` | `/coach/notifications/read` | `coachGuard` | Mark coach notifications as read. |
| `GET` | `/coach/clients` | `coachGuard` | List all assigned clients and trainees. |
| `GET` | `/coach/clients/:memberId/packages` | `coachGuard` | Inspect active packages and remaining PT sessions for a client. |
| `GET` | `/coach/clients/:memberId/deductions` | `coachGuard` | View deduction history for a client. |
| `POST` | `/coach/deduct` | `coachGuard` | **Deduct PT Session**: Atomically decrements package balance, creates a `DeductionLog`, and updates attendance records. |
| `GET` | `/coach/schedule` | `coachGuard` | View assigned class schedule calendar. |
| `GET` | `/coach/scans` | `coachGuard` | View scan and check-in history for coach's classes. |
| `GET` | `/coach/pt-attendance` | `coachGuard` | View historical PT session attendance records. |
| `GET` | `/coach/tickets` | `coachGuard` | List support tickets submitted by this coach. |
| `POST` | `/coach/tickets` | `coachGuard` | Submit a new support ticket to management. |
| `GET` | `/coach/ticket-categories` | `coachGuard` | Get active ticket categories. |

---

### 8.4 Member Client Routes (`/member`)

| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/member/profile` | Yes | `member`, `user` | Fetch member profile, active memberships, and stats. |
| `GET` | `/member/classes` | Yes | `member`, `user` | List booked classes for the authenticated member. |
| `POST` | `/member/book/:scid` | Yes | `member`, `user` | Book into a scheduled class using an active package credit. |
| `POST` | `/member/dropIn` | Yes | `member`, `user` | Book a drop-in session. |
| `POST` | `/member/subToWaitingList` | Yes | `member`, `user` | Join waitlist when a class is full. |
| `DELETE` | `/member/cancel/:scid` | Yes | `member`, `user` | Cancel booking within cancellation window and restore credit. |
| `POST` | `/member/cancel-dropin/:scid` | Yes | `member`, `user` | Cancel drop-in booking. |
| `POST` | `/member/attend/:attendanceId` | Yes | `member`, `user` | Dynamic QR check-in scan verification. |
| `GET` | `/member/packages` | Yes | `member`, `user` | List available packages for purchase in mobile store. |
| `GET` | `/member/member-packages` | Yes | `member`, `user` | List authenticated member's active and expired packages. |
| `POST` | `/member/packages` | Yes | `member`, `user` | Subscribe to a package post-payment. |
| `DELETE` | `/member/packages/:pkgId` | Yes | `member` | Member-initiated package cancellation. |
| `GET` | `/member/schedule` | Yes | `member`, `user` | View public schedule filtered by branch, date, and category. |
| `POST` | `/member/fcm/update-token/:fcmToken` | Yes | `member`, `user` | Register/refresh FCM push notification token. |
| `DELETE` | `/member/fcm/update-token/:fcmToken` | Yes | `member`, `user` | Unregister FCM token upon logout. |
| `GET` | `/member/coaches` | Yes | `member`, `user` | Browse coach profiles and bios. |
| `GET` | `/member/locations` | Yes | `member`, `user` | Browse gym branches, coordinates, and contact numbers. |

---

### 8.5 Wellness Challenge Routes (`/challenge`)

All challenge routes require `authenticateUser` and `checkChallengeSubscription()`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/challenge/subscribe` | Enroll member in the active 30-day / Ramadan challenge. |
| `POST` | `/challenge/init` | Initialize member challenge progress document. |
| `POST` | `/challenge/initRun` | Initialize running distance milestones. |
| `POST` | `/challenge/initWorkout` | Initialize daily workout calendar. |
| `GET` | `/challenge/record` | Get comprehensive member challenge statistics. |
| `POST` | `/challenge/run/update` | Log kilometers run for today. |
| `POST` | `/challenge/run/reset` | Reset running record for today. |
| `GET` | `/challenge/run/details` | Detailed run history and milestone achievements. |
| `POST` | `/challenge/meditation/update` | Log daily meditation minutes. |
| `POST` | `/challenge/meditation/reset` | Reset daily meditation log. |
| `POST` | `/challenge/water-intake/update` | Add water intake (ml) to daily counter. |
| `POST` | `/challenge/water-intake/reset` | Reset water intake counter for today. |
| `GET` | `/challenge/places` | List participating charity partners. |
| `POST` | `/challenge/places` | Admin: Add charity organization. |
| `POST` | `/challenge/charity/update` | Record charitable action or donation. |
| `POST` | `/challenge/charity/reset` | Reset charity log for today. |
| `POST` | `/challenge/workout/update` | Mark daily workout routine complete. |
| `POST` | `/challenge/workout/reset` | Reset daily workout flag. |
| `POST` | `/challenge/reads/update` | Log pages / chapters of reading / Quran. |
| `POST` | `/challenge/reads/reset` | Reset reading progress for today. |

---

### 8.6 Social Feed Routes (`/feed`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/feed` | Publish a community post (caption, image URL, challenge milestone). |
| `POST` | `/feed/like` | Toggle like on a feed post. |
| `GET` | `/feed/global` | Fetch paginated global community activity feed. |

---

### 8.7 Exposed / Public Routes (`/external`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/external/unlinked-coaches` | Management: Lookup coach profiles not yet linked to user accounts. |
| `POST` | `/external/register-coach` | Management: Create credentials and link user account for a coach. |
| `GET` | `/external/ticket-categories` | Public: Fetch active support ticket categories for submission. |
| `POST` | `/external/tickets` | Public/Authenticated: Submit a support ticket from public web or app. |

---

## 9. Database Models & Schemas

### 9.1 Core Entities Matrix

```mermaid
erDiagram
    User ||--o| Member : "extends"
    User ||--o| Coach : "linked_to"
    Member ||--o{ Reservation : "places"
    Member ||--o{ DailyAttendance : "checks_in"
    Member ||--o{ ChallengeRecord : "owns"
    Member ||--o{ Order : "purchases"
    
    Package ||--o{ Member : "subscribed_by"
    Class ||--o{ ScheduledClass : "instantiates"
    ScheduledClass ||--o{ Reservation : "has_bookings"
    ScheduledClass ||--o{ WaitlistEntry : "has_waitlist"
    Coach ||--o{ ScheduledClass : "instructs"
    Location ||--o{ ScheduledClass : "hosts"
    Location ||--o{ User : "assigned_to"
    
    Payment ||--o| Refund : "refunded_by"
    Order ||--o{ Payment : "settled_by"
    TicketCategory ||--o{ Ticket : "categorizes"
```

### 9.2 Key Model Details

#### `User` (`src/models/user.ts`)
- **Fields**: `email` (unique), `password` (bcrypt hash), `name`, `phoneNumber` (11 digits unique), `role` (`management | branch_admin | coach | member | user`), `locationId` (ref Location), `tokens` (array of JWTs + device + expiry), `resetCode`, `fcmTokens` (array of push tokens), `createdAt`.
- **Methods**: `comparePassword()`, `generateAuthToken(deviceType, fcmToken)`, `removeToken(token)`, `removeAllTokens()`, `removeExpiredTokens()`.

#### `Member` (`src/models/member.ts`)
- **Fields**: `userId` (ref User), `memberPackages` (`[{ packageId, remainingSessions, expiryDate, status }]`), `gender`, `birthDate`, `emergencyContact`, `attendanceHistory`, `notes`, `isBanned`.

#### `ScheduledClass` (`src/models/scheduledClass.ts`)
- **Fields**: `classId` (ref Class), `coachId` (ref Coach), `locationId` (ref Location), `startTime` (Date), `endTime` (Date), `maxCapacity` (Number), `bookedCount` (Number), `reservations` (`[{ memberId, reservationDate, status }]`), `waitlist` (`[{ memberId, joinedAt }]`), `status` (`scheduled | ongoing | completed | cancelled`).

#### `DailyAttendance` (`src/models/dailyAttendance.ts`)
- **Fields**: `date` (Date string YYYY-MM-DD), `locationId` (ref Location), `scans` (`[{ userId, memberId, type: 'class'|'opengym'|'pt', time, scheduledClassId, coachId, status: 'success'|'failed', failReason }]`).

#### `Payment` & `Refund` (`src/models/payment.ts`, `src/models/refund.ts`)
- **Payment Fields**: `memberId`, `amount`, `currency`, `method` (`card | cash | geidea | pos`), `transactionId`, `type` (`package | pos_order | dropin`), `status` (`completed | refunded | partial_refund | void`), `locationId`, `createdAt`.
- **Refund Fields**: `paymentId`, `memberId`, `refundAmount`, `reason`, `processedBy` (ref User), `createdAt`.

#### `Ticket` & `TicketCategory` (`src/models/ticket.ts`, `src/models/ticketCategory.ts`)
- **Ticket Fields**: `ticketNumber`, `userId` / `coachId` / `memberId`, `categoryId` (ref TicketCategory), `subject`, `description`, `status` (`open | in_progress | resolved | closed`), `assignedTo`, `comments`.
- **Category Fields**: `name`, `description`, `targetRole` (`member | coach | all`), `isActive`.

---

## 10. Real-Time WebSocket Engine (Socket.io)

The API mounts a Socket.io server on the HTTP listener (`src/index.ts`). It broadcasts front-desk scan events across all connected staff monitors.

### 10.1 Emitted Events

#### `SUCCESS-SCAN`
Emitted immediately when a member checks in successfully via dynamic QR code or front-desk check-in.
```json
{
  "event": "SUCCESS-SCAN",
  "data": {
    "scanId": "65e6f1a8c9812401",
    "member": {
      "id": "65e6d2b512a4b891c9812401",
      "name": "Sarah Mansour",
      "phoneNumber": "01012345678"
    },
    "type": "class",
    "className": "Vinyasa Yoga",
    "locationId": "65e6c1a8c9812400",
    "timestamp": "2026-08-25T14:30:00.000Z"
  }
}
```

#### `FAILED-SCAN`
Emitted when a scan fails (e.g. invalid QR token, expired package, class full, already checked in).
```json
{
  "event": "FAILED-SCAN",
  "data": {
    "scanId": "65e6f1a8c9812402",
    "member": {
      "id": "65e6d2b512a4b891c9812401",
      "name": "Tamer Hosny"
    },
    "reason": "PACKAGE_EXPIRED",
    "message": "Member package expired on 2026-08-01",
    "locationId": "65e6c1a8c9812400",
    "timestamp": "2026-08-25T14:31:15.000Z"
  }
}
```

---

## 11. Services Layer

| Service File | Responsibility |
|---|---|
| `bookings-service.ts` | Handles atomic reservations, drop-in deduplication, capacity checking, and QR attendance verification. |
| `subscriptions-service.ts` | Manages package purchases, session balance increments, category compatibility, and expiry math. |
| `package-deletion-guard.ts` | Analyzes dependency graph of packages before deletion to prevent breaking active member memberships. |
| `payments-service.ts` | Validates idempotent payment callbacks, processes refunds, and maintains financial ledgers. |
| `orders-service.ts` | Point-of-Sale order checkout, stock inventory decrement, and receipt numbering. |
| `scheduler-service.ts` | Handles class recurrence calculation, coach clash detection, and slot generation. |
| `waitlist-service.ts` | Implements FIFO waitlist queue with automated and manual promotion pipelines. |
| `sheet-service.ts` | Computes daily operational attendance sheet and validates real-time package eligibility. |
| `notifications-service.ts` | Dispatches high-priority Firebase FCM push notifications for class cancellations, reminders, and waitlist promotions. |
| `brevo-mail-service.ts` | Integrates with Brevo REST API to deliver transactional emails and dashboard broadcast campaigns. |
| `imap-service.ts` | Establishes persistent IMAP connection with gym inbox to ingest incoming client emails into the dashboard support desk. |
| `egygap-erp-service.ts` | Synchronizes financial ledgers and attendance aggregates with external enterprise ERP systems. |

---

## 12. Maintenance Scripts & Seeders

Available in `package.json` and `src/scripts/`:

```bash
# Seed initial database structure (locations, default admin, initial classes)
npm run seed

# Seed support ticket categories
npm run seed:tickets

# Synchronize production database dump to local test environment
npm run sync-db

# Regenerate Swagger API HTML documentation
npm run generate-docs

# Backfill and normalize location IDs across historical records
npm run backfill-locations
npm run normalize-location-ids:apply
```

---

## 13. Testing & Quality Assurance

The test suite leverages Jest, Supertest, and `mongodb-memory-server` for zero-side-effect in-memory database testing.

```bash
# Run changed test suites since master
npm test

# Run specific integration test suite
npx jest src/tests/integration/admin-routes.test.ts --runInBand

# Run full test suite with code coverage
npm run coverage

# Run specialized package and payment test flows
npm run test:package-flows
npm run test:member-payment-flow
```
