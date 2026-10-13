/**
 * Test Coachera Webhook Intake Script
 *
 * Usage:
 *   npx ts-node scripts/test-coachera-webhook.ts
 *   or:
 *   npx ts-node scripts/test-coachera-webhook.ts --secret=YOUR_SECRET --url=http://localhost:5000/mindspace-intake
 */

import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import http from "http";

dotenv.config({ path: path.join(__dirname, "../dev.env") });

// Parse command line args
const args = process.argv.slice(2);
const secretArg = args.find((a) => a.startsWith("--secret="))?.split("=")[1];
const urlArg = args.find((a) => a.startsWith("--url="))?.split("=")[1];

const secret = secretArg || process.env.COACHERA_SECRET;
const targetUrl = urlArg || "http://localhost:5000/mindspace-intake";

if (!secret) {
  console.error("❌ ERROR: COACHERA_SECRET is not set in dev.env or provided via --secret=YOUR_SECRET");
  console.log("Please add COACHERA_SECRET to dev.env or run with: npx ts-node scripts/test-coachera-webhook.ts --secret=<value>");
  process.exit(1);
}

const sampleOrder = {
  order_id: `GD-${Math.floor(10000 + Math.random() * 90000)}`,
  coach_email: "salma.ghazzawi@gmail.com",
  client: {
    name: "Client Name",
    email: "client@gmail.com",
    phone: "+201000000000",
  },
  duration_months: 3,
  amount: 4500,
  currency: "EGP",
  paid_at: "2026-09-30",
};

async function sendWebhook() {
  const body = JSON.stringify(sampleOrder);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto
    .createHmac("sha256", secret!)
    .update(`${ts}.${body}`)
    .digest("hex");

  console.log("==========================================");
  console.log("🚀 Testing Coachera Intake Webhook");
  console.log(`Endpoint:    ${targetUrl}`);
  console.log(`Timestamp:   ${ts}`);
  console.log(`Signature:   ${sig}`);
  console.log(`Order ID:    ${sampleOrder.order_id}`);
  console.log(`Coach Email: ${sampleOrder.coach_email}`);
  console.log(`Amount:      ${sampleOrder.amount} ${sampleOrder.currency}`);
  console.log("==========================================\n");

  const url = new URL(targetUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-mindspace-timestamp": ts,
      "x-mindspace-signature": sig,
    },
  };

  const req = http.request(options, (res) => {
    let responseData = "";
    res.on("data", (chunk) => {
      responseData += chunk;
    });
    res.on("end", () => {
      console.log(`Status Code: ${res.statusCode} ${res.statusMessage}`);
      try {
        const parsed = JSON.parse(responseData);
        console.log("Response Body:", JSON.stringify(parsed, null, 2));
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log("\n✅ Webhook test passed successfully!");
        } else {
          console.log("\n⚠️ Webhook returned error response.");
        }
      } catch {
        console.log("Response Raw:", responseData);
      }
    });
  });

  req.on("error", (err) => {
    console.error("❌ Connection error:", err.message);
    console.log("Make sure the API server is running on localhost (npm run dev).");
  });

  req.write(body);
  req.end();
}

sendWebhook();
