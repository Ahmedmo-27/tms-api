import { NextFunction, Request, Response, Router } from "express";
import { authenticateUser, authorizeUser } from "../middlewares/auth.middleware";
import { ForbiddenError } from "../core/ApiError";
import {
  getFinanceBranches,
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

financeRoutes.get("/overview", getFinanceOverview);
financeRoutes.get("/sales", getFinanceSales);
financeRoutes.get("/coaches", getFinanceCoaches);
financeRoutes.get("/coach-hours", getFinanceCoachHours);
financeRoutes.get("/coaches/:coachId/package-usage", getFinanceCoachUsage);
financeRoutes.get("/pt", getFinancePt);
financeRoutes.get("/deferred-revenue", getFinanceDeferred);
financeRoutes.get("/branches", getFinanceBranches);
financeRoutes.get("/retention", getFinanceRetention);
financeRoutes.get("/ledger", getFinanceLedger);
financeRoutes.get("/refunds", getFinanceRefunds);

export default financeRoutes;
