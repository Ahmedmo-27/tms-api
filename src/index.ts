import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "..", "dev.env") });
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import connectDB from "./config/db";
import logger from "./config/logger";

const app = require("./app"); // your Express app

const startServer = async () => {
  await connectDB();

  const port = Number(process.env.PORT) || 5000;

  // Create HTTP server using Express app
  const server = createServer(app);

  // Attach socket.io to HTTP server
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*", // Or restrict to your frontend domain
    },
  });

  // Set io on the app for usage in routes/controllers
  app.set("io", io);

  io.on("connection", (socket) => {
    logger.info("Dashboard Connected", socket.id);

    socket.on("disconnect", () => {
      logger.info("Dashboard Disconnected", socket.id);
    });
  });

  // Start the server (NOT app.listen)
  server.listen(port, "0.0.0.0", () => {
    logger.info(`Server is listening at http://0.0.0.0:${port}`);
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
