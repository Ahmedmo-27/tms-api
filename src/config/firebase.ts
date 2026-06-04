import logger from "./logger";
import * as admin from "firebase-admin";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const isPlaceholder = !raw || raw === "FILL_IN";

if (isPlaceholder) {
  logger.warn(
    "Firebase service account not configured — push notifications disabled"
  );
} else {
  try {
    const serviceAccountKey = JSON.parse(
      Buffer.from(raw, "base64").toString()
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountKey),
    });
    logger.info("Firebase initialized");
  } catch (error) {
    logger.error("Firebase initialization failed", {
      message: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

export default admin;
