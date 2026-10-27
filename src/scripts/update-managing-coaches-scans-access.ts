import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import User from "../models/user";
import Coach from "../models/coach";

async function main() {
  const isProd = process.argv.includes("--prod");
  const isApply = process.argv.includes("--apply");
  const envFile = isProd ? "prod.env" : "dev.env";
  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

  console.log(`Connecting to ${envFile}... Mode: ${isApply ? "APPLY" : "DRY-RUN"}`);
  await mongoose.connect(process.env.MONGO_URI!);

  // 1. Hana Abaza
  const hanaAbazaUser = await User.findOne({
    $or: [
      { name: { $regex: /hana abaza/i } },
      { email: "hhanaabaza@gmail.com" },
      { phoneNumber: "01222161664" },
    ],
  });

  if (hanaAbazaUser) {
    console.log(`Found Hana Abaza User: ${hanaAbazaUser._id}, current role: ${hanaAbazaUser.role}`);
    const hanaAbazaCoaches = await Coach.find({
      $or: [
        { userId: hanaAbazaUser._id },
        { coachName: { $regex: /hana abaza/i } },
        { phoneNumber: "01222161664" },
      ],
    });
    console.log(`Found Hana Abaza Coach docs: ${hanaAbazaCoaches.map((c) => c._id)}`);

    if (isApply) {
      hanaAbazaUser.role = "managing_coach";
      hanaAbazaUser.scansCategories = ["FUNCTIONAL_TRAINING"];
      await hanaAbazaUser.save();

      for (const c of hanaAbazaCoaches) {
        c.scansCategories = ["FUNCTIONAL_TRAINING"];
        await c.save();
      }
      console.log("Updated Hana Abaza User & Coach documents.");
    }
  } else {
    console.warn("Hana Abaza user not found!");
  }

  // 2. Hana Rashwan
  const hanaRashwanUser = await User.findOne({
    $or: [
      { name: { $regex: /hana rashwan/i } },
      { email: "hanarashwan@aucegypt.edu" },
      { phoneNumber: "01001061010" },
    ],
  });

  if (hanaRashwanUser) {
    console.log(`Found Hana Rashwan User: ${hanaRashwanUser._id}, current role: ${hanaRashwanUser.role}`);
    const hanaRashwanCoaches = await Coach.find({
      $or: [
        { userId: hanaRashwanUser._id },
        { coachName: { $regex: /hana rashwan/i } },
        { phoneNumber: "01001061010" },
      ],
    });
    console.log(`Found Hana Rashwan Coach docs: ${hanaRashwanCoaches.map((c) => c._id)}`);

    if (isApply) {
      hanaRashwanUser.role = "managing_coach";
      hanaRashwanUser.scansCategories = ["STUDIO"];
      await hanaRashwanUser.save();

      for (const c of hanaRashwanCoaches) {
        c.scansCategories = ["STUDIO"];
        await c.save();
      }
      console.log("Updated Hana Rashwan User & Coach documents to managing_coach with STUDIO scansCategories.");
    }
  } else {
    console.warn("Hana Rashwan user not found!");
  }

  await mongoose.disconnect();
  console.log("Finished.");
}

main().catch(console.error);
