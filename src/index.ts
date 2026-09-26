import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", "dev.env") });
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import connectDB from "./config/db";
import logger from "./config/logger";
import { syncEmails } from "./services/imap-service";
import { PackageStatusService } from "./services/package-status-service";
import { MissedSessionService } from "./services/missed-session-service";
import { WaitlistService } from "./services/waitlist-service";
import { CORS_ORIGINS } from "./config/corsOrigins";
import User from "./models/user";
import Member from "./models/member";
import { setIO } from "./config/socket";

const app = require("./app"); // your Express app

const startServer = async () => {
  await connectDB();

  try {
    // Migration: ensure all existing member and mobile tokens never expire by removing expiresIn
    await User.updateMany(
      { role: { $in: ["member", "user"] } },
      { $unset: { "tokens.$[].expiresIn": 1 }, $set: { "tokens.$[].device": "mobile" } }
    );
    await User.updateMany(
      { "tokens.device": "mobile" },
      { $unset: { "tokens.$[elem].expiresIn": 1 } },
      { arrayFilters: [{ "elem.device": "mobile" }] }
    );
    logger.info("Migrated member and mobile tokens to non-expiring");

    // Ensure all users with active member packages have role: "member"
    const membersWithActivePkgs = await Member.find({
      "packages.status": { $in: ["ACTIVE", "FROZEN"] },
    }).select("uid");
    const activeUids = membersWithActivePkgs.map((m) => m.uid).filter(Boolean);
    if (activeUids.length > 0) {
      await User.updateMany(
        { _id: { $in: activeUids }, role: "user" },
        { $set: { role: "member" } }
      );
    }

    // Ensure all users with role: "member" have a Member document
    const memberUsers = await User.find({ role: "member" }).select("_id");
    if (memberUsers.length > 0) {
      const memberUserIds = memberUsers.map((u) => u._id);
      const existingMemberDocs = await Member.find({
        uid: { $in: memberUserIds },
      }).select("uid");
      const existingUidsSet = new Set(existingMemberDocs.map((m) => m.uid?.toString()));
      const missingUsers = memberUsers.filter(
        (u: any) => !existingUidsSet.has(u._id?.toString())
      );
      if (missingUsers.length > 0) {
        await Member.insertMany(
          missingUsers.map((u: any) => ({
            uid: u._id,
            packages: [],
            bookings: [],
            attendance: [],
            isActive: true,
          }))
        );
        logger.info(`Self-healed ${missingUsers.length} missing Member documents`);
      }
    }
  } catch (migErr) {
    logger.warn("Token migration warning:", migErr);
  }

  const port = Number(process.env.PORT) || 5000;

  const server = createServer(app);

  const io = new SocketIOServer(server, {
    cors: {
      origin: CORS_ORIGINS,
      credentials: true,
    },
  });

  app.set("io", io);
  setIO(io);

  io.on("connection", (socket) => {
    logger.info("Dashboard Connected", socket.id);

    socket.on("disconnect", () => {
      logger.info("Dashboard Disconnected", socket.id);
    });

    socket.on("coach:joinRoom", async (payload: string | { coachId?: string; token?: string }) => {
      try {
        const coachId =
          typeof payload === "string" ? payload : payload?.coachId;
        const token =
          typeof payload === "object" && payload?.token
            ? payload.token
            : (socket.handshake.auth as { token?: string })?.token ||
              (socket.handshake.headers.authorization?.startsWith("Bearer ")
                ? socket.handshake.headers.authorization.slice(7)
                : undefined);

        if (!coachId || !token) {
          socket.emit("error", { message: "Authentication required to join coach room" });
          return;
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
          socket.emit("error", { message: "Server misconfigured" });
          return;
        }

        const decoded = jwt.verify(token, secret) as { uid: string; role: string };
        const user = await User.findOne({
          _id: new Types.ObjectId(decoded.uid),
          "tokens.token": token,
        });

        if (!user || (user.role !== "coach" && user.role !== "managing_coach")) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Only allow joining the room for the authenticated coach's own user id
        if (decoded.uid !== coachId && String(user._id) !== coachId) {
          socket.emit("error", { message: "Forbidden room" });
          return;
        }

        socket.join(`coach:${coachId}`);
        socket.join(`user:${coachId}`);
        logger.info("Coach joined room", { socketId: socket.id, coachId });
      } catch (err) {
        logger.warn("coach:joinRoom rejected", {
          error: (err as Error).message,
        });
        socket.emit("error", { message: "Unauthorized" });
      }
    });

    socket.on("mail:joinRoom", async (payload?: { token?: string }) => {
      try {
        const token =
          (payload && typeof payload === "object" ? payload.token : undefined) ||
          (socket.handshake.auth as { token?: string })?.token ||
          (socket.handshake.headers.authorization?.startsWith("Bearer ")
            ? socket.handshake.headers.authorization.slice(7)
            : undefined);

        if (!token) {
          socket.emit("error", { message: "Authentication required to join mail room" });
          return;
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
          socket.emit("error", { message: "Server misconfigured" });
          return;
        }

        const decoded = jwt.verify(token, secret) as { uid: string; role: string };
        const user = await User.findOne({
          _id: new Types.ObjectId(decoded.uid),
          "tokens.token": token,
        });

        if (!user) {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        const role = user.role === "admin" ? "management" : user.role;
        const allowedRoles = ["management", "managing_coach", "mailer"];
        if (!allowedRoles.includes(role)) {
          socket.emit("error", { message: "Forbidden: No mailing access" });
          return;
        }

        socket.join(`user:${user._id}`);
        logger.info("User joined mail room", { socketId: socket.id, userId: user._id, role });
      } catch (err) {
        logger.warn("mail:joinRoom rejected", {
          error: (err as Error).message,
        });
        socket.emit("error", { message: "Unauthorized" });
      }
    });
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Server is listening at http://0.0.0.0:${port}`);

    syncEmails().catch((err) => logger.error("Initial IMAP sync failed", err));
    setInterval(() => {
      syncEmails().catch((err) => logger.error("IMAP sync failed", err));
    }, 2 * 60 * 1000);

    PackageStatusService.syncAllPackageStatuses().catch((err) =>
      logger.error("Initial package status sync failed", err)
    );
    setInterval(() => {
      PackageStatusService.syncAllPackageStatuses().catch((err) =>
        logger.error("Periodic package status sync failed", err)
      );
    }, 10 * 60 * 1000);

    if (MissedSessionService.isNotificationEnabled()) {
      MissedSessionService.notifyMissedSessions().catch((err) =>
        logger.error("Initial missed session notification run failed", err)
      );
      setInterval(() => {
        MissedSessionService.notifyMissedSessions().catch((err) =>
          logger.error("Periodic missed session notification run failed", err)
        );
      }, 10 * 60 * 1000);
    } else {
      logger.info(
        "Missed session notifications disabled (running in development/testing environment)"
      );
    }

    WaitlistService.expireReservations().catch((err) =>
      logger.error("Initial waitlist reservation expiration failed", err)
    );
    setInterval(() => {
      WaitlistService.expireReservations().catch((err) =>
        logger.error("Waitlist reservation expiration failed", err)
      );
    }, 60 * 1000);
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception:", err);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection:", reason);
  });
};

startServer().catch((error) => {
  logger.error("Failed to start server: ", error);
  process.exit(1);
});
