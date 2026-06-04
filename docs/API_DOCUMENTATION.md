# TMS API — Technical Documentation

REST API backend for **The Mind Space** gym management system.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Setup & Configuration](#setup--configuration)
5. [Architecture](#architecture)
6. [Authentication & Authorization](#authentication--authorization)
7. [Rate Limiting](#rate-limiting)
8. [Error Handling](#error-handling)
9. [Response Format](#response-format)
10. [API Routes](#api-routes)
    - [Auth Routes](#auth-routes----auVth)
    - [Admin Routes](#admin-routes----admin)
    - [Member Routes](#member-routes----member)
    - [Challenge Routes](#challenge-routes----challenge)
    - [Feed Routes](#feed-routes----feed)
11. [Data Models](#data-models)
12. [Services](#services)
13. [Real-Time (Socket.io)](#real-time-socketio)
14. [Testing](#testing)



## Project Overview

The TMS API is an Express.js REST API that powers The Mind Space gym management platform. It supports:

- User registration, login, and JWT-based authentication
- Admin and front-desk management of members, classes, schedules, coaches, and locations
- Member self-service: booking classes, managing packages, tracking attendance
- Real-time attendance scanning via Socket.io
- Push notifications via Firebase Cloud Messaging (FCM)
- A wellness challenge system with run tracking, workout logs, meditation, water intake, and charity goals
- A social feed tied to the challenge system
- A point-of-sale module for products and orders

---

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript 5.8 |
| Framework | Express.js 4 |
| Database | MongoDB via Mongoose 8 |
| Real-time | Socket.io 4 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Push Notifications | Firebase Admin SDK |
| Email | Resend |
| Logging | Winston |
| API Docs | Swagger (swagger-jsdoc + swagger-ui-express) |
| Rate Limiting | express-rate-limit |
| Testing | Jest + Supertest + mongodb-memory-server |

---

## Project Structure

```
tms_api/
├── src/
│   ├── index.ts               # Entry point — creates HTTP server & Socket.io
│   ├── app.ts                 # Express app — middleware, routes, error handling
│   ├── config/
│   │   ├── db.ts              # MongoDB connection
│   │   ├── firebase.ts        # Firebase Admin SDK init
│   │   ├── logger.ts          # Winston logger
│   │   ├── rateLimiter.ts     # Rate limiter configurations
│   │   ├── swagger.ts         # Swagger spec setup
│   │   └── env.ts             # Environment variable helpers
│   ├── core/
│   │   ├── ApiError.ts        # Typed error classes
│   │   └── ApiResponse.ts     # Typed response classes
│   ├── middlewares/
│   │   ├── auth.middleware.ts       # JWT authentication & role authorization
│   │   ├── challenge.middleware.ts  # Challenge subscription gate
│   │   └── publicPkgs.middleware.ts # Public packages shortcut
│   ├── routes/
│   │   ├── index.ts           # Route aggregator
│   │   ├── auth-routes.ts
│   │   ├── admin-routes.ts
│   │   ├── member-routes.ts
│   │   ├── challenge-routes.ts
│   │   ├── feed-routes.ts
│   │   └── exposed-routes.ts  # External/public endpoints
│   ├── controllers/
│   │   ├── admin/             # Admin-facing controllers
│   │   ├── auth/              # Auth controllers
│   │   └── client/            # Member-facing controllers
│   ├── models/                # Mongoose schemas & models
│   ├── services/              # Business logic & external integrations
│   ├── dtos/                  # Data transfer objects (e.g. schedule.dto.ts)
│   ├── utils/
│   │   ├── asyncHandler.ts    # Wraps async controllers to avoid try/catch
│   │   ├── requestContext.ts  # Extracts context from requests for error logs
│   │   └── transaction.ts     # MongoDB session/transaction helpers
│   ├── types/
│   │   └── app-request.d.ts   # Extended Request type definitions
│   ├── scripts/
│   │   └── generate-docs.ts   # Swagger HTML doc generation script
│   └── tests/
│       ├── setup.ts           # Jest global test setup
│       ├── utils/testHelpers.ts
│       └── integration/       # Integration test suites
├── dev.env                    # Local environment variables (not committed)
├── package.json
└── tsconfig.json
```

---

## Setup & Configuration

### Environment Variables (`dev.env`)

Place this file in the root of `tms_api/`.

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `5000`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign and verify JWTs |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `EMAIL_USER` | Verified sender email address for Resend |
| Firebase vars | Service account credentials for FCM push notifications |

### Commands

```bash
cd tms_api

npm run dev          # Start dev server with nodemon (watches src/, uses dev.env)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (dist/index.js)
npm test             # Run changed tests since master (Jest, --runInBand)
npm run coverage     # Run all tests with coverage report
npm run generate-docs # Regenerate Swagger HTML documentation
npm run seed         # Seed the database with initial data
```

Run a single test file:

```bash
npx jest src/tests/integration/admin-routes.test.ts --runInBand
```

---

## Architecture

### Request Lifecycle

```
Client Request
    |
    v
CORS + Cookie Parser + JSON Parser
    |
    v
Rate Limiter (defaultLimiter)
    |
    v
Request Logger (Winston)
    |
    v
Router  (/admin, /member, /auth, /challenge, /feed, /external)
    |
    v
Auth Middleware (authenticateUser -> authorizeUser)
    |
    v
Controller (wrapped with asyncHandler)
    |
    +-- throws ApiError subclass  ->  Global Error Handler  ->  Typed HTTP response
    |
    +-- calls SuccessResponse.send(res)  ->  200 JSON response
```

### Key Design Decisions

- **`asyncHandler`** — All controller functions are wrapped with `asyncHandler` so thrown errors bubble up to the global error handler without explicit try/catch in every controller.
- **`ApiError` hierarchy** — Controllers throw typed error subclasses (`BadRequestError`, `NotFoundError`, `ConflictError`, etc.). The global handler in `app.ts` calls `ApiError.handle(err, res)` which maps each error type to the correct HTTP status.
- **MongoDB transactions** — Multi-document operations (booking a class, subscribing to a package) use Mongoose `ClientSession` transactions via `src/utils/transaction.ts` to maintain data consistency.
- **Socket.io on the app** — The Socket.io server is attached via `app.set("io", io)` in `index.ts` and retrieved via `req.app.get("io")` inside controllers that need to emit real-time events (e.g., attendance scan results to the dashboard).

---

## Authentication & Authorization

### Token Transport

The API supports two token transports simultaneously:

| Client Type | How token is sent | `deviceType` set to |
|---|---|---|
| Web (dashboard) | HTTP-only cookie named `token` | `"web"` |
| Mobile app | `Authorization: Bearer <token>` header | `"mobile"` |

### JWT Payload

```json
{
  "uid": "<user_id>",
  "role": "admin | fd | member | user",
  "deviceType": "web | mobile",
  "jti": "<uuid>",
  "iat": 1234567890
}
```

Tokens are signed with `JWT_SECRET` and expire in **10 years**. Token lists are stored on the `User` document, allowing server-side revocation (logout, logout-all).

### Roles

| Role | Description |
|---|---|
| `admin` | Full access to all admin operations |
| `fd` | Front-desk — access to most admin operations except destructive ones |
| `member` | Registered gym member with an active membership |
| `user` | Registered but not yet assigned as a member (pending approval) |

The `authorizeUser` middleware includes a **role upgrade check**: if a `user`-role token hits an endpoint, it checks if the user has since been promoted to `member` and, if so, forces a token refresh (sends back a new token via `TokenExpiredError` with code `TOKEN_UPDATED`).

### Middleware Functions

```typescript
authenticateUser                    // Validates JWT, loads user from DB, attaches to req.user
authorizeUser(roles: UserRole[])    // Checks req.user.role against allowed roles
```

---

## Rate Limiting

| Limiter | Window | Max Requests | Applied To |
|---|---|---|---|
| `defaultLimiter` | 15 minutes | 100 per IP | All routes |
| `loginLimiter` | 5 minutes | 5 per IP | `POST /auth/login` |
| `resetPasswordLimiter` | 1 hour | 3 per IP | `POST /auth/reset-password` |
| `resetPasswordGlobalLimiter` | 24 hours | 495 (shared globally) | `POST /auth/reset-password` |

Rate-limit responses return HTTP `429` with:

```json
{ "statusCode": 429, "message": "Too many requests, please try again later.", "code": "RATE_LIMITED" }
```

---

## Error Handling

All errors are represented as `ApiError` subclasses thrown from controllers. The global error handler in `app.ts` catches them and delegates to `ApiError.handle(err, res)`.

### Error Types & HTTP Status Codes

| Error Class | HTTP Status |
|---|---|
| `AuthFailureError` | 401 |
| `BadTokenError` | 401 |
| `TokenExpiredError` | 401 |
| `AccessTokenError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `BadRequestError` | 400 |
| `InternalError` | 500 |

### Usage Pattern in Controllers

```typescript
if (!member) throw new NotFoundError("MEMBER_NOT_FOUND", "Member not found");
```

### Error Response Shape

```json
{
  "statusCode": 404,
  "message": "Member not found",
  "code": "MEMBER_NOT_FOUND"
}
```

---

## Response Format

### Success

```typescript
new SuccessResponse("message", data).send(res);
```

```json
{
  "statusCode": 200,
  "message": "Member retrieved successfully",
  "data": { }
}
```

### Error

```json
{
  "statusCode": 400,
  "message": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

---

## API Routes

### Auth Routes — `/auth`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/auth` | Yes | admin, fd | Get current user info |
| `DELETE` | `/auth` | Yes | admin, member | Deactivate account |
| `POST` | `/auth/register` | No | — | Register a new user |
| `POST` | `/auth/register-manually` | No | — | Admin-created user registration |
| `POST` | `/auth/login` | No (rate-limited) | — | Login and receive JWT |
| `GET` | `/auth/logout` | Yes | any | Logout current device |
| `GET` | `/auth/logout-all` | Yes | any | Logout all devices |
| `POST` | `/auth/reset-password` | No (rate-limited) | — | Send password reset code via email |
| `POST` | `/auth/confirm-password-reset` | No | — | Confirm reset code and set new password |
| `GET` | `/auth/verifyToken` | Yes | admin, fd | Verify token validity (used by dashboard on load) |

---

### Admin Routes — `/admin`

All routes require `authenticateUser`. Default role requirement is `["admin", "fd"]` unless marked **admin only**.

#### Members

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/member` | admin, fd | Get member(s) |
| `POST` | `/admin/member/:id` | admin, fd | Create/assign member profile for a user |
| `GET` | `/admin/pending-members` | admin, fd | List users pending member approval |

#### Schedule

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/schedule` | admin, fd | Get all scheduled classes |
| `GET` | `/admin/next-schedule` | admin, fd | Get upcoming scheduled classes |
| `POST` | `/admin/schedule` | admin, fd | Schedule a new class instance |
| `DELETE` | `/admin/schedule/:scid` | admin, fd | Cancel a scheduled class |
| `PATCH` | `/admin/schedule/:scid` | admin, fd | Edit a scheduled class |
| `GET` | `/admin/daily-attendance` | admin, fd | Get daily attendance overview |

#### Classes (CRUD)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/class` | admin, fd | List all class types |
| `POST` | `/admin/class` | admin, fd | Create a new class type |
| `PATCH` | `/admin/class/:cid` | admin only | Update a class type |
| `DELETE` | `/admin/class/:cid` | admin only | Delete a class type |

#### Bookings

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/bookings` | admin, fd | Get bookings for a member |
| `POST` | `/admin/book` | admin, fd | Book a member into a class |
| `DELETE` | `/admin/cancel` | admin, fd | Cancel a member's booking |

#### Non-User Bookings (Walk-ins / Guests)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/nonUserBooking` | admin, fd | List non-user bookings |
| `POST` | `/admin/nonUserBooking` | admin, fd | Create a non-user booking |
| `POST` | `/admin/nonUserBooking/attend` | admin, fd | Record attendance for a non-user booking |
| `POST` | `/admin/nonUserBooking/pay` | admin, fd | Record payment for a non-user booking |
| `POST` | `/admin/nonUserBooking/cancel/:bookingId` | admin, fd | Cancel a non-user booking |
| `POST` | `/admin/nonUserBooking/walk-in` | admin, fd | Add a same-day walk-in |

#### Non-User Packages

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/admin/nonUserPackage` | admin, fd | Create a package for a non-user |
| `GET` | `/admin/nonUserPackage` | admin, fd | List non-user packages |

#### Packages (CRUD)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/packages` | admin, fd | List all available packages |
| `POST` | `/admin/packages` | admin, fd | Create a new package |
| `DELETE` | `/admin/packages/:id` | admin only | Delete a package |
| `PATCH` | `/admin/packages/:id` | admin only | Update a package |

#### Member Packages (Subscriptions)

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/admin/member-packages` | admin only | Subscribe a member to a package |
| `DELETE` | `/admin/member-packages` | admin only | Unsubscribe a member from a package |
| `PATCH` | `/admin/member-packages/edit` | admin only | Edit a member's package (sessions, expiry) |

#### Coaches

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/coaches` | admin only | List all coaches |
| `POST` | `/admin/coaches` | admin only | Add a new coach |
| `PATCH` | `/admin/coaches/:id` | admin only | Update a coach |
| `DELETE` | `/admin/coaches/:id` | admin only | Delete a coach |

#### Locations

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/locations` | admin, fd | List all locations/branches |
| `POST` | `/admin/locations` | admin only | Add a new location |
| `PATCH` | `/admin/locations/:id` | admin only | Update a location |
| `DELETE` | `/admin/locations/:id` | admin only | Delete a location |

#### Payments

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/payments` | admin only | List all payment records |

#### Products (Inventory)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/products` | admin only | List all products |
| `POST` | `/admin/product` | admin only | Add a new product |
| `PATCH` | `/admin/products/:barcode` | admin only | Edit a product |
| `DELETE` | `/admin/product/:barcode` | admin only | Delete a product |

#### Orders (Point of Sale)

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/admin/orders` | admin only | List all orders |
| `POST` | `/admin/orders` | admin only | Create a new order |
| `DELETE` | `/admin/orders/:barcode` | admin only | Delete an order |

#### Notifications

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/admin/send-message` | admin, fd | Send a custom push notification |

---

### Member Routes — `/member`

All routes require `authenticateUser`.

#### Profile

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/member/profile` | member, user | Get the authenticated member's profile |

#### Class Bookings

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/member/classes` | member, user | Get the member's current bookings |
| `POST` | `/member/book/:scid` | member | Book a scheduled class |
| `POST` | `/member/dropIn` | member | Book a drop-in session (requires payment) |
| `POST` | `/member/subToWaitingList` | member | Join the waiting list for a full class |
| `DELETE` | `/member/cancel/:scid` | member | Cancel a class booking |
| `POST` | `/member/cancel-dropin` | member | Cancel a drop-in booking |
| `POST` | `/member/attend/:attendanceId` | member | Record attendance (QR scan flow) |

#### Packages

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/member/packages` | member | List available packages |
| `GET` | `/member/member-packages` | member | Get the member's subscribed packages |
| `POST` | `/member/packages` | member | Subscribe to a package |
| `DELETE` | `/member/packages/:pkgId` | member | Unsubscribe from a package |

#### Schedule

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/member/schedule` | member | Get the class schedule |

#### Coaches & Locations

| Method | Path | Roles | Description |
|---|---|---|---|
| `GET` | `/member/coaches` | member, user | List all coaches |
| `GET` | `/member/locations` | member, user | List all branches/locations |

#### Push Notifications (FCM)

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/member/fcm/update-token/:fcmToken` | user, member | Register a new FCM device token |
| `DELETE` | `/member/fcm/update-token/:fcmToken` | user, member | Remove an FCM device token |

---

### Challenge Routes — `/challenge`

All routes require `authenticateUser`. Routes below `/subscribe` also require `checkChallengeSubscription`.

#### Subscription

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/subscribe` | Subscribe the authenticated user to the challenge |

#### Initialization

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/init` | Initialize the member's challenge record (30-day daily challenges) |
| `POST` | `/challenge/initRun` | Initialize run challenge (choose 5km or 10km, 4-week program) |
| `POST` | `/challenge/initWorkout` | Initialize workout challenge (4 weeks x 4 days) |

#### Record

| Method | Path | Description |
|---|---|---|
| `GET` | `/challenge/record` | Get the member's full challenge record |

#### Run Challenge

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/run/update` | Log a run entry (intervals / easy run / long run) |
| `POST` | `/challenge/run/reset` | Reset a run entry |
| `GET` | `/challenge/run/details` | Get run details |

#### Meditation (Daily)

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/meditation/update` | Update meditation progress for a day (0-100%) |
| `POST` | `/challenge/meditation/reset` | Reset meditation for a day |

#### Water Intake (Daily)

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/water-intake/update` | Update water intake progress for a day (0-100%) |
| `POST` | `/challenge/water-intake/reset` | Reset water intake for a day |

#### Charity (Daily)

| Method | Path | Description |
|---|---|---|
| `GET` | `/challenge/places` | Get all charity places |
| `POST` | `/challenge/places` | Add a charity place |
| `POST` | `/challenge/charity/update` | Mark charity task as completed for a day |
| `POST` | `/challenge/charity/reset` | Reset charity task for a day |

#### Workout

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/workout/update` | Mark a workout day as completed |
| `POST` | `/challenge/workout/reset` | Reset a workout day |

#### Reads (Daily)

| Method | Path | Description |
|---|---|---|
| `POST` | `/challenge/reads/update` | Mark reads as completed for a day |
| `POST` | `/challenge/reads/reset` | Reset reads for a day |

---

### Feed Routes — `/feed`

All routes require `authenticateUser` + `authorizeUser(["member", "user"])` + `checkChallengeSubscription`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/feed` | Create a new feed post |
| `POST` | `/feed/like` | Like a feed post |
| `GET` | `/feed/global` | Get the global challenge feed |

---

## Data Models

### User

Core identity model stored in the `users` collection.

| Field | Type | Notes |
|---|---|---|
| `email` | String | Unique, lowercase, validated format |
| `password` | String | Bcrypt-hashed, min 8 chars, must contain upper/lower/digit |
| `name` | String | Required |
| `phoneNumber` | String | Unique, exactly 11 digits |
| `role` | Enum | `"admin" / "fd" / "member" / "user"` |
| `tokens` | Token[] | Active auth tokens per device (`{ token, device, expiresIn }`) |
| `fcmTokens` | String[] | FCM push notification tokens |
| `resetCode` | String | Temporary password reset OTP |
| `createdAt` | Date | Auto-set on creation |

**Instance methods**: `comparePassword`, `generateAuthToken`, `removeToken`, `removeAllTokens`, `removeExpiredTokens`

**Static methods**: `findByCredentials(phoneNumber, password)`

---

### Member

Links a `User` to their gym membership data, stored in the `members` collection.

| Field | Type | Notes |
|---|---|---|
| `uid` | ObjectId | Ref to `User` |
| `packages` | MemberPackage[] | Active/past package subscriptions |
| `bookings` | Booking[] | Class booking records |
| `attendance` | Attendance[] | Confirmed class attendance records |
| `ptAttendance` | PtAttendance[] | Personal training session attendance |
| `isActive` | Boolean | Whether membership is active |

**MemberPackage sub-document:**

| Field | Type | Notes |
|---|---|---|
| `pkgId` | ObjectId | Ref to `Package` |
| `name` | String | Denormalized package name |
| `pkgStartDate` | Date | |
| `pkgEndDate` | Date | |
| `status` | Enum | `ACTIVE / EXPIRED / DELETED / COMPLETED` |
| `remainingClasses` | Number | Sessions remaining |
| `classRestrictionsRecord` | Array | Per-class monthly usage tracking (`{ cid, limit, record: [{ month, remainingSessions }] }`) |

**Static methods**: `saveBooking`, `saveDropIn`, `removeBooking`, `removeDropIn`, `recordAttendance`, `recordPtAttendance`, `addPackage`, `removePackage`, `editPackageClasses`, `editExpiryDate`

The `saveBooking` static intelligently selects the oldest active package that opens the target class, auto-expires/completes packages with 0 remaining sessions, and handles monthly class restriction limits.

---

### Package

Defines a membership or session package offered by the gym.

| Field | Type | Notes |
|---|---|---|
| `name` | String | Package name |
| `numberOfSessions` | Number | Default 10000 (effectively unlimited) |
| `price` | Number | |
| `expiryPeriod` | Number | Days until package expires from start date |
| `category` | Enum | `FUNCTIONAL_TRAINING`, `STUDIO`, `PERSONAL_TRAINING`, `PRE_POST_NATAL`, `MIXED`, `SPACE_MEMBERSHIP`, `ULTIMATE_MINDSPACER` |
| `opensClasses` | ObjectId[] | Which class types this package grants access to |
| `classRestrictions` | Array | Per-class monthly session limits (`{ cid, limit }`) |
| `coachId` | ObjectId | Ref to `Coach` (for PT packages) |
| `hidden` | Boolean | If true, not shown in public listings |

**Static methods**: `getClassPackages(cid, location)` — returns all package IDs that open a given class type, including "Ultimate Mindspacer" packages for the location.

---

### Class

Defines a class type (template used to create scheduled instances).

| Field | Type | Notes |
|---|---|---|
| `title` | String | Class name |
| `category` | String | Class category |
| `price` | Number | Drop-in price |
| `locations` | ObjectId[] | Refs to `Location` |
| `points` | Number | Session cost deducted per booking (default: 1) |

---

### ScheduledClass

A specific instance of a class at a given date and time.

| Field | Type | Notes |
|---|---|---|
| `cid` | ObjectId | Ref to `Class` |
| `startTime` | Date | |
| `endTime` | Date | |
| `availableSlots` | Number | Decrements on each booking, increments on cancellation |
| `bookedMembers` | Array | `{ uid: ObjectId, method: string }` — method is the package ID used |
| `coachId` | ObjectId | Ref to `Coach` |
| `scans` | MemberScan[] | QR scan records (`{ uid, scanTime, method, status }`) |
| `waitingList` | String[] | FCM tokens of waiting members (notified on slot open) |

**Static methods**: `bookMember`, `bookNonUser`, `removeBookedMember`, `removeBookedNonUser`, `addMemberScan`

**Instance methods**: `checkBookedMember`, `addMemberToWaitingList`

---

### Schedule

Maps a calendar date to its list of scheduled class IDs.

| Field | Type | Notes |
|---|---|---|
| `date` | Date | Normalized to UTC midnight |
| `classes` | ObjectId[] | Refs to `ScheduledClass` |

**Static methods**: `getClasses(date)`, `getAllClasses()`, `getNextClasses()`, `scheduleClass(scid)`, `cancelClass(scid, session)`, `rescheduleClass(oldClass, newClass, session)`

---

### Coach

| Field | Type |
|---|---|
| `coachName` | String |
| `phoneNumber` | String |

---

### Location

| Field | Type |
|---|---|
| `branchName` | String |
| `location` | String |
| `locationUrl` | String |

---

### Payment

Records a financial transaction.

| Field | Type | Notes |
|---|---|---|
| `uid` | ObjectId | Ref to `User` (optional for non-user payments) |
| `nonMemberName` | String | For guest/non-user payments |
| `nonMemberPhone` | String | |
| `amount` | Number | |
| `paymentMethod` | Enum | `APP / VISA / CASH / INSTAPAY / VALU / PAYMENT_LINK / DEDUCTED` |
| `paymentTime` | Date | |
| `purpose` | Enum | `DROPIN / PACKAGE / WALKIN / NON_USER_BOOKING / NON_USER_PACKAGE / OTHER` |
| `scid` | ObjectId | Ref to `ScheduledClass` (optional) |
| `pkgId` | ObjectId | Ref to `Package` (optional) |
| `note` | String | Optional note |
| `isRefunded` | Boolean | Default: false |

---

### NonUserBooking

Tracks bookings made for guests (non-registered users).

| Field | Type | Notes |
|---|---|---|
| `scid` | ObjectId | Ref to `ScheduledClass` |
| `name` | String | Guest name |
| `phoneNumber` | String | 11-digit phone number |
| `status` | Enum | `BOOKED / ATTENDED / PAID / CANCELLED` |
| `bookingTime` | Date | |
| `attendanceTime` | Date | Optional, set when status becomes ATTENDED |
| `paymentId` | ObjectId | Ref to `Payment` (optional) |

**Static methods**: `addBooking`, `recordAttendance`, `recordPayment`, `cancelBooking`

---

### Product

Inventory item for the point-of-sale system.

| Field | Type | Notes |
|---|---|---|
| `barcode` | String | Unique, indexed |
| `brand` | String | |
| `item` | String | Product name |
| `price` | Number | |
| `quantity` | Number | Current stock count |

**Static methods**: `deductItem(barcode, quantity, session)`, `returnItem(barcode, quantity, session)`

---

### Order

A point-of-sale cart/transaction.

| Field | Type | Notes |
|---|---|---|
| `cart` | CartItem[] | `{ barcode: string, quantity: number }` |
| `total` | Number | Running total, updated atomically on add/remove |
| `createdAt` / `updatedAt` | Date | Auto-managed timestamps |

**Static methods**: `addItem`, `removeItem`, `decrementItem`

---

### ChallengeRecord

Tracks a member's progress across all challenge components. One document per user (unique on `uid`).

| Field | Type | Notes |
|---|---|---|
| `uid` | ObjectId | Ref to `User`, unique |
| `runChallenge` | Object | `{ subscription: "5km"/"10km", weeks: WeekRecord[4] }` |
| `workoutChallenge` | Object | `{ weeks: WorkoutWeek[4] }` — 4 weeks, 4 days each |
| `dailyChallenges` | DayRecord[30] | One record per day for 30 days |

**Run WeekRecord structure**: Each week has three run entries (`intervals`, `easyRun`, `longRun`) each with `distance`, `pace`, `duration`, `route`, and `status` (`DONE / INPROGRESS`). A `weekComplete` flag is auto-set when all three runs are DONE.

**WorkoutWeek structure**: 4 weeks, each with 4 days (`{ dayNumber, completed, scid? }`). `weekComplete` is auto-set when all 4 days are completed.

**DayRecord structure**: Each day tracks `meditation.progress` (0-100%), `waterIntake.progress` (0-100%), `charity.completed`, `reads.completed`, and a derived `dayComplete` flag (true when all four are complete).

**Static methods**: `initRecord`, `initRun`, `initWorkout`, `updateRun`, `resetRun`, `updateMeditation`, `resetMeditation`, `updateWaterIntake`, `resetWaterIntake`, `updateCharity`, `resetCharity`, `updateWorkoutDay`, `resetWorkoutDay`, `updateReads`, `resetReads`

---

## Services

| Service | File | Responsibility |
|---|---|---|
| Email | `email-service.ts` | Sends transactional email (password reset codes) via Resend |
| Notifications | `notifications-service.ts` | FCM push notifications — multicast with 500-token chunking, waiting list alerts, custom messages |
| Bookings | `bookings-service.ts` | Booking business logic shared between admin and member controllers |
| Subscriptions | `subscriptions-service.ts` | Package subscription logic |
| Payments | `payments-service.ts` | Payment record creation and retrieval |
| Orders | `orders-service.ts` | Order management and stock deduction |
| Scheduler | `scheduler-service.ts` | Scheduled class creation and management |
| Challenge | `challenge-service.ts` | Challenge initialization and update orchestration |
| Feed | `feed-service.ts` | Social feed post creation, retrieval, and likes |
| EgyGap ERP | `egygap-erp-service.ts` | Integration with external ERP system |

### NotificationsService

The `NotificationsService` class (`notifications-service.ts`) handles all FCM push delivery:

- Splits token lists into chunks of 500 (Firebase's `sendEachForMulticast` limit)
- Automatically cleans up invalid/unregistered tokens from the database on failure
- Used by waiting list logic: when a member cancels a fully-booked class, FCM tokens on the `waitingList` are notified via `notifyWaitingList()`

---

## Real-Time (Socket.io)

The Socket.io server is initialized in `index.ts` and shared with all controllers via `app.set("io", io)`. Controllers retrieve it with `req.app.get("io")`.

### Connection

The dashboard connects to the same HTTP server port. The Socket.io CORS is set to `"*"` (all origins) — can be restricted in production.

### Server-Emitted Events

| Event | Payload | Trigger |
|---|---|---|
| `FAILED-SCAN` | `{ code, message, member }` | Attendance scan fails — member not booked, already attended, or no active package |

The dashboard listens for `FAILED-SCAN` to display real-time feedback during class check-in as members scan their QR codes at the front desk.

---

## Testing

Tests use **Jest** with **Supertest** for HTTP integration tests and **mongodb-memory-server** for an isolated in-memory MongoDB instance.

### Test Setup (`src/tests/setup.ts`)

- Starts an in-memory MongoDB instance before all tests
- Connects Mongoose to it
- Clears all collections between tests
- Closes the connection after all tests complete

### Test Helpers (`src/tests/utils/testHelpers.ts`)

Factory functions for creating test fixtures:

- `createAuthenticatedAdmin()` — creates an admin user and returns a valid auth token
- `createTestMember()` — creates a user + member record
- Additional helpers for creating packages, classes, and schedules

### Running Tests

```bash
# Run tests changed since master
npm test

# Run all tests with coverage
npm run coverage

# Run a specific test file
npx jest src/tests/integration/admin-routes.test.ts --runInBand
```

Tests run with `--runInBand` to ensure serial execution (required with shared in-memory MongoDB).

### Test Files

| File | Coverage |
|---|---|
| `auth-routes.test.ts` | Registration, login, logout, token verification |
| `admin-routes.test.ts` | Admin CRUD operations, bookings, schedule management |
| `member-routes.test.ts` | Member profile, booking, package, and schedule endpoints |

---

## Swagger Documentation

Swagger UI is served at `/api-docs` when the server is running.

To regenerate the static HTML documentation:

```bash
npm run generate-docs
```

This runs `src/scripts/generate-docs.ts` and outputs a static Swagger HTML file.
