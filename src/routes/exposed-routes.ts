import express from "express";
import { exposedGetPayments } from "../controllers/admin/payments-controller";

const exposedRoutes = express.Router();

// exposedRoutes.get("/", exposedGetPayments);

export default exposedRoutes;