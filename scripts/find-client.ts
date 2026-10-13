import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../dev.env") });
import mongoose from "mongoose";
import User from "../src/models/user";
import Member from "../src/models/member";
import Payment from "../src/models/payment";

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "");
  console.log("Connected to MongoDB");

  const users = await User.find({
    $or: [{ email: /jessica/i }, { phoneNumber: /1221664556/ }],
  }).lean();
  console.log("Found Users:", users);

  const members = await Member.find({
    $or: [{ email: /jessica/i }, { phoneNumber: /1221664556/ }],
  })
    .populate("currentPackages.package")
    .lean();
  console.log("Found Members:", JSON.stringify(members, null, 2));

  const payments = await Payment.find({
    $or: [
      { nonMemberName: /jessica/i },
      { nonMemberPhone: /1221664556/ },
      { uid: { $in: users.map((u: any) => u._id) } },
    ],
  }).lean();
  console.log("Found Payments:", payments);

  await mongoose.disconnect();
}

main().catch(console.error);
