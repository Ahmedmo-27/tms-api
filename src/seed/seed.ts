import User from "../models/user";
import Member from "../models/member";
import mongoose from "mongoose";
import logger from "../config/logger";
import { cleanupDatabase } from "../test/utils/cleanup";
import path from "path";

const fs = require("fs").promises;

const seed = async () => {
  const db_uri = process.env.MONGO_URI || ""
  await mongoose.connect(db_uri);
  await cleanupDatabase();
  try {
    logger.info("logging");
    
const filePath = path.join(__dirname, "members.json");
    const members = await fs.readFile(
      filePath,
      { encoding: "utf-8" } // change this path to your local path to members.json file, if needed.
    );
    const parsedMembers = JSON.parse(members);
    const admin = new User({
      email: "omar.tolan@gmail.com",
      password: "Admin1234",
      name: "Omar Tolan",
      phoneNumber: "01207522334",
      role: "admin",
    });
    await admin.save();
    const numbers: string[] = [];
    for (const member of parsedMembers) {
      member["Phone number"] = member["Phone number"].replace(/ /g, "");
      if (member["Phone number"].length !== 11) continue;
      if (numbers.includes(member["Phone number"])) continue;
      numbers.push(member["Phone number"]);
      const randomNo = Math.floor(Math.random() * 1000000000);
      const user = new User({
        email: `${randomNo}@gmail.com`, // this is to make sure that the email is unique. This is not needed if the email is already unique.
        password: "Thisismypass123",
        name: member["Name"],
        phoneNumber: member["Phone number"],
        role: "member",
      });
      console.log(user.name);
      await user.save();
      const memberData = new Member({
        uid: user._id,
        name: member["Name"],
        phoneNumber: member["Phone number"],
        packages: [],
        bookings: [],
        attendance: [],
      });
      console.log(member.name)
      for (const pkg of member.packages) {
        if (pkg["status"]?.toLowerCase() == "unknown") pkg["status"] = "Expired";
        if (pkg["status"]?.toLowerCase() == "active") pkg["status"] = "Active";
        if (pkg["status"]?.toLowerCase() == "finished") pkg["status"] = "Completed";
        if (pkg["status"]?.toLowerCase() == "expired") pkg["status"] = "Expired";
        if (pkg["status"]?.toLowerCase() == "pending") continue;
        if (pkg["remainingClasses"] == null) pkg["remainingClasses"] = 0;
        console.log(pkg.name)
        memberData.packages.push({
          pkgId: new mongoose.Types.ObjectId(),
          name: pkg["Name"],
          pkgStartDate: new Date(pkg["packageStartDate"]._seconds * 1000),
          pkgEndDate: new Date(pkg["PackageEndDate"]._seconds * 1000),
          status: pkg["status"],
          remainingClasses: pkg["remainingClasses"],
        });
      }
      await memberData.save();
    } // this line is not needed as it is already saved in the loop above. It is just to show that the loop is working. It can be removed.
    console.log("Done Seeding")
    return;
  } catch (error) {
    return;
  }
};

seed().then(() => {
  console.log("Done seeding - Starting server")
  process.exit(0)
}).catch((error) => {
  console.log("Seeding Failed: ", error)
  process.exit(1)
});
