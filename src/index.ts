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
import { isAllowedCorsOrigin } from "./config/corsOrigins";
import User from "./models/user";

const app = require("./app"); // your Express app

const startServer = async () => {
  await connectDB();

  const port = Number(process.env.PORT) || 5000;

  const server = createServer(app);

  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedCorsOrigin(origin));
      },
      credentials: true,
    },
  });

  app.set("io", io);

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

        if (!user || user.role !== "coach") {
          socket.emit("error", { message: "Unauthorized" });
          return;
        }

        // Only allow joining the room for the authenticated coach's own user id
        if (decoded.uid !== coachId && String(user._id) !== coachId) {
          socket.emit("error", { message: "Forbidden room" });
          return;
        }

        socket.join(`coach:${coachId}`);
        logger.info("Coach joined room", { socketId: socket.id, coachId });
      } catch (err) {
        logger.warn("coach:joinRoom rejected", {
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
