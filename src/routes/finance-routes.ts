import { NextFunction, Request, Response, Router } from "express";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { ForbiddenError } from "../core/ApiError";
import {
  getFinanceBranches,
  getFinanceClassDetail,
  getFinanceCoachHours,
  getFinanceCoachUsage,
  getFinanceCoaches,
  getFinanceDeferred,
  getFinanceLedger,
  getFinanceOverview,
  getFinancePt,
  getFinanceRefunds,
  getFinanceRetention,
  getFinanceSales,
} from "../controllers/admin/finance-controller";
import { cacheResponse } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

/**
 * Finance analytics — read-only. Only GET is accepted on this router.
 * Available to management and the accountant role.
 */
const financeRoutes = Router();

financeRoutes.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    return next(new ForbiddenError("READ_ONLY", "Finance endpoints are read-only"));
  }
  next();
});
financeRoutes.use(authenticateUser, authorizeUser(["management", "accountant"]));

const financeCache = cacheResponse({
  ttlMs: 60_000,
  scope: "user",
  tags: [CacheTags.finance],
});

financeRoutes.get("/overview", financeCache, getFinanceOverview);
financeRoutes.get("/sales", financeCache, getFinanceSales);
financeRoutes.get("/coaches", financeCache, getFinanceCoaches);
financeRoutes.get("/coach-hours", financeCache, getFinanceCoachHours);
financeRoutes.get("/class-detail", financeCache, getFinanceClassDetail);
financeRoutes.get("/coaches/:coachId/package-usage", financeCache, getFinanceCoachUsage);
financeRoutes.get("/pt", financeCache, getFinancePt);
financeRoutes.get("/deferred-revenue", financeCache, getFinanceDeferred);
financeRoutes.get("/branches", financeCache, getFinanceBranches);
financeRoutes.get("/retention", financeCache, getFinanceRetention);
financeRoutes.get("/ledger", financeCache, getFinanceLedger);
financeRoutes.get("/refunds", financeCache, getFinanceRefunds);

export default financeRoutes;
