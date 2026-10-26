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

salesRoutes.get("/accounts", listSalesAccounts);
salesRoutes.get("/packages", listSoldPackages);
salesRoutes.patch("/packages/:memberPackageId/seller", assignSoldPackageSeller);

export default salesRoutes;
