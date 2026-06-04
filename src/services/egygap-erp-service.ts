import axios from "axios";
import { Types } from "mongoose";
import logger from "../config/logger";
import { IPayment } from "../models/payment";
import { InternalError } from "../core/ApiError";

// Disable on testing
const disabled = process.env.ENVIRONMENT === "testing"

// Validate and clean environment variables
if (!disabled && (!process.env.EGYGAP_ERP_BASE_URL || !process.env.EGYGAP_ERP_LOGIN_URL || !process.env.EGYGAP_ERP_SALES_URL || !process.env.RENTAL_USER || !process.env.RENTAL_PASS || !process.env.RENTAL_STORE_ID)) {
  throw new InternalError("EGYGAP_ERP_INTEGRATION_ERROR", "Missing required environment variables for ERP integration");
}

const BASE_URL = process.env.EGYGAP_ERP_BASE_URL!
const LOGIN_PATH = process.env.EGYGAP_ERP_LOGIN_URL!
const SALES_PATH = process.env.EGYGAP_ERP_SALES_URL!


const LOGIN_URL: string = `${BASE_URL}${LOGIN_PATH}`
const SALES_URL: string = `${BASE_URL}${SALES_PATH}`

// Debug logging to see the actual URLs
logger.info("ERP Configuration:", { 
  BASE_URL, 
  LOGIN_URL, 
  SALES_URL 
});

const RENTAL_USER: string = process.env.RENTAL_USER!;
const RENTAL_PASS: string = process.env.RENTAL_PASS!;
const RENTAL_STORE_ID: string = process.env.RENTAL_STORE_ID!;

// Configure axios with timeout
const erpAxios = axios.create({
  timeout: 30000, // 30 seconds
  withCredentials: true
});

// Store cookie in memory
let sessionCookie: string | null = null;

/** LOGIN TO ERP */
async function loginToERP() {
  try {
    logger.info("Attempting to login to ERPNext");
    if (disabled){
      logger.info("TESTING ENV DETECTED: skipping ERPNext login")
      return;
    }    
    const res = await erpAxios.post(
      LOGIN_URL,
      new URLSearchParams({
        usr: RENTAL_USER,
        pwd: RENTAL_PASS,
      })
    );

    const rawCookie = res.headers["set-cookie"]?.[0];
    if (!rawCookie) {
      throw new InternalError("EGYGAP_ERP_INTEGRATION_ERROR", "No session cookie returned from ERPNext");
    }

    sessionCookie = rawCookie.split(";")[0];
    logger.info("✔ Successfully logged into ERPNext");

    return true;
  } catch (err: any) {
    const errorMessage = err.response?.data || err.message || 'Unknown error';
    const statusCode = err.response?.status;
    logger.error("❌ ERPNext Login Failed:", { message: errorMessage, status: statusCode });
    throw new InternalError("EGYGAP_ERP_INTEGRATION_ERROR", `ERPNext login failed: ${errorMessage}`);
  }
}

/** SEND PAYMENT TO Rental Integration API */
async function createRentalPayment(body: any) {
  try {
    const headers = sessionCookie ? { Cookie: sessionCookie } : {};
    
    logger.info("Sending payment to ERPNext", { external_id: body.external_id });
    
    let res = {
      data: {}
    }

    if(!disabled){
     res = await erpAxios.post(SALES_URL, body, { headers });
         logger.info("✔ Payment successfully sent to ERPNext", { external_id: body.external_id });

    }

    logger.info("✔ Payment not sent to ERPNext (TESTING EN)");

    return res.data;

  } catch (err: any) {
    if (err.response?.status === 403 || err.response?.status === 401) {
      logger.warn("⚠ ERPNext session expired — re-logging in…");
      await loginToERP();

      const res = await erpAxios.post(SALES_URL, body, { headers: { Cookie: sessionCookie } });
      logger.info("✔ Payment successfully sent to ERPNext after re-login", { external_id: body.external_id });
      return res.data;
    }

    const errorMessage = err.response?.data || err.message || 'Unknown error';
    const statusCode = err.response?.status;
    logger.error("❌ ERPNext payment sync failed:", { message: errorMessage, status: statusCode });
    throw new InternalError("EGYGAP_ERP_INTEGRATION_ERROR", `Failed to sync payment to ERPNext: ${errorMessage}`);
  }
}

/** PUBLIC FUNCTION → Call this from your main payment handler */
export async function sendPaymentToRentalSystem(payment: IPayment) {
  // Map your internal payment to ERP request format
  const invoiceDate = new Date(payment.paymentTime).toISOString().substring(0, 10);
  const payload = {
    store: RENTAL_STORE_ID,
    invoice_date: invoiceDate,
    invoice_amount: payment.amount,
    net_amount: payment.amount,
    external_id: `${RENTAL_STORE_ID}-${(payment._id as Types.ObjectId).toString()}`,    
    external_reference: (payment._id as Types.ObjectId).toString(),  
    external_type: 0,                
    external_type_name: "Active"
  };

  // Ensure logged-in
  if (!sessionCookie) await loginToERP();

  return createRentalPayment(payload);
}

/** PUBLIC FUNCTION → Call this to refund a payment from the ERP */
export async function refundPaymentToRentalSystem(payment: IPayment) {
  // Refund uses the current date instead of the original payment date
  const invoiceDate = new Date().toISOString().substring(0, 10);
  const payload = {
    store: RENTAL_STORE_ID,
    invoice_date: invoiceDate,
    invoice_amount: -payment.amount,
    net_amount: -payment.amount,
    // Add -refund to avoid external_id collision
    external_id: `${RENTAL_STORE_ID}-refund-${(payment._id as Types.ObjectId).toString()}`,    
    external_reference: `refund-${(payment._id as Types.ObjectId).toString()}`,  
    external_type: 0,                
    external_type_name: "Active"
  };

  // Ensure logged-in
  if (!sessionCookie) await loginToERP();

  return createRentalPayment(payload);
}
