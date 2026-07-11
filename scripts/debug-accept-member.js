#!/usr/bin/env node
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", "dev.env") });

const API = process.env.API_URL || "http://localhost:5000";
const ADMIN_UID = "6a08da73f4d4567c2bfec6f7";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const token = jwt.sign(
    { uid: ADMIN_UID, role: "management", deviceType: "web", jti: `debug-${Date.now()}` },
    process.env.JWT_SECRET
  );
  await mongoose.connection.collection("users").updateOne(
    { _id: new mongoose.Types.ObjectId(ADMIN_UID) },
    { $push: { tokens: { token, device: "web" } } }
  );
  await mongoose.disconnect();

  const phone = `0176${Date.now().toString().slice(-8)}`;
  const regRes = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Debug Pending",
      email: `debug${phone}@test.com`,
      password: "TestPass1!",
      phoneNumber: phone,
      role: "user",
    }),
  });
  const reg = await regRes.json();
  const uid = reg.data?.user?._id;
  console.log("register", regRes.status, uid);

  const acceptRes = await fetch(`${API}/admin/member/${uid}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const accept = await acceptRes.json();
  console.log("accept", acceptRes.status, JSON.stringify(accept, null, 2));
}

main().catch(console.error);
