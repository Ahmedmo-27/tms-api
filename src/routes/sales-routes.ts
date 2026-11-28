import { Router } from "express";
import {
  authenticateUser,
  authorizeUser,
} from "../middlewares/auth.middleware";
import {
  assignSoldPackageSeller,
  listSalesAccounts,
  listSoldPackages,
} from "../controllers/admin/sales-controller";
import { cacheResponse, invalidateCache } from "../middlewares/cacheResponse";
import { CacheTags } from "../cache/response-cache";

/**
 * Sales attribution — reads sold packages and sets which sales account sold
 * each one. Open to the sales_manager role plus management, branch_admin and
 * the accountant; branch_admin is scoped to its own branch by
 * resolveLocationFilter. Setting the attribution is the accountant's one write
 * in this API — it is read-only everywhere else.
 */
const salesRoutes = Router();

salesRoutes.use(
  authenticateUser,
  authorizeUser(["management", "branch_admin", "sales_manager", "accountant"]),
);

salesRoutes.get(
  "/accounts",
  cacheResponse({ ttlMs: 30_000, scope: "user", tags: [CacheTags.sales] }),
  listSalesAccounts,
);
salesRoutes.get(
  "/packages",
  cacheResponse({ ttlMs: 30_000, scope: "user", tags: [CacheTags.sales] }),
  listSoldPackages,
);
salesRoutes.patch(
  "/packages/:memberPackageId/seller",
  invalidateCache([CacheTags.sales, CacheTags.members]),
  assignSoldPackageSeller,
);

export default salesRoutes;
