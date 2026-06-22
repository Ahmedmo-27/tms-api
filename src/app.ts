import express, {
  ErrorRequestHandler,
  Request,
  Response,
  NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import router from "./routes";
import { ApiError, InternalError } from "./core/ApiError";
import { defaultLimiter } from "./config/rateLimiter";
import logger from "./config/logger";
import { getRequestContext } from "./utils/requestContext";
import { specs, swaggerUi } from "./config/swagger";
import cors from "cors";

const app = express();

app.set("trust proxy", 1); // Enable trusting proxy to fix express-rate-limit X-Forwarded-For error

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3803",
      "https://tms-dashboard-ashen.vercel.app",
      "https://tms-dashboard-test.vercel.app", // Add mobile client
      "https://tms-dashboard-psi.vercel.app",
    ],
    credentials: true, // Allow cookies / Authorization headers
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(defaultLimiter);

// Add route logging middleware before other middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info("Route accessed:", {
    method: req.method,
    path: req.path,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: req.headers,
  });
  next();
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
app.use(router);
// Mirror all routes under /api for dashboard clients that prefix requests with /api
app.use("/api", router);

app.get("/", (req, res) => {
  res.send("API running!");
});

app.use(((err: Error, req: Request, res: Response, next: NextFunction) => {
  // get request context
  const requestContext = getRequestContext(req);

  // If it's not an ApiError or doesn't have context, convert it to InternalError with context
  if (!(err instanceof ApiError)) {
    const internalError = new InternalError("INTERNAL_ERROR", err.message, {
      ...requestContext,
      originalError: {
        name: err.name,
        message: err.message,
      },
    });
    return ApiError.handle(internalError, res);
  }

  // If it's an ApiError but doesn't have context, add it
  if (err instanceof ApiError && Object.keys(err.context).length === 0) {
    err.context = requestContext;
  }

  // Merge request context with existing context
  err.context = {
    ...requestContext,
    ...err.context, // This preserves specific context from constructor
  };

  // Handle the error
  ApiError.handle(err, res);
}) as ErrorRequestHandler);

app.use((req, res) => {
  // Log the route that was not found
  logger.error("Route not found:", req.method, req.path);
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
