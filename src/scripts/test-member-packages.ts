import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
import connectDB from "../config/db";
import User from "../models/user";
import Package from "../models/package";

// Import Express app
const app = require("../app");

async function main() {
  await connectDB();
  console.log("Connected to MongoDB.");

  // Find a test member or user
  const user = (await User.findOne({ role: { $in: ["member", "user"] } })) as any;
  if (!user) {
    console.error("No member/user found in the database to run the test!");
    await mongoose.disconnect();
    return;
  }
  console.log(`Using test user: ${user.name} (${user.role}) - ID: ${user._id}`);

  // Create a JWT token for the user
  const secret = process.env.JWT_SECRET || "FILL_IN";
  const token = jwt.sign({ uid: user._id.toString(), role: user.role }, secret);

  // Push token to user's tokens array so auth middleware accepts it
  await User.updateOne(
    { _id: user._id },
    { $push: { tokens: { token, signedAt: new Date().toISOString() } } }
  );
  console.log("Temporary token generated and added to DB.");

  try {
    // Perform GET request
    console.log("Sending GET request to /api/member/packages...");
    const response = await request(app)
      .get("/api/member/packages")
      .set("Authorization", `Bearer ${token}`);

    console.log(`Response Status: ${response.status}`);
    
    if (response.status !== 200) {
      console.error("Request failed:", response.body);
      return;
    }

    const packages = response.body.data;
    console.log(`Returned packages count: ${packages.length}`);

    // Check if the deprecated package "10 Personal Training with Shoukry" is present
    const targetName = "10 Personal Training with Shoukry";
    const foundDeprecated = packages.find((p: any) => p.name === targetName || p.isDeprecated === true);

    if (foundDeprecated) {
      console.error(`[FAIL] Found deprecated package in client list!`, foundDeprecated);
    } else {
      console.log(`[PASS] Deprecated package "${targetName}" is NOT present in the client packages list.`);
    }

    // Double check that we received other active packages
    if (packages.length > 0) {
      console.log("Sample returned package:", {
        id: packages[0]._id,
        name: packages[0].name,
        category: packages[0].category,
        isDeprecated: packages[0].isDeprecated
      });
    }

  } catch (error) {
    console.error("Test error:", error);
  } finally {
    // Cleanup the token
    await User.updateOne(
      { _id: user._id },
      { $pull: { tokens: { token } } }
    );
    console.log("Temporary token cleaned up from DB.");
    await mongoose.disconnect();
  }
}

main().catch(console.error);
