import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../../dev.env") });

import mongoose from "mongoose";
import Package from "../models/package";
import Member from "../models/member";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not found in env!");
    return;
  }
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  // Find the package "10 Personal Training with Shoukry"
  const pkgName = "10 Personal Training with Shoukry";
  const pkgs = await Package.find({ name: { $regex: pkgName, $options: "i" } });
  console.log(`Found ${pkgs.length} packages matching "${pkgName}":`);
  
  for (const pkg of pkgs) {
    const activeSubscribersCount = await Member.countDocuments({
      packages: {
        $elemMatch: {
          pkgId: pkg._id,
          status: "ACTIVE",
        },
      },
    });
    console.log({
      id: pkg._id.toString(),
      name: pkg.name,
      category: pkg.category,
      isDeprecated: (pkg as any).isDeprecated,
      hidden: pkg.hidden,
      activeSubscribersCount,
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);
