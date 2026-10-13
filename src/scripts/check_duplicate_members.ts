import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";

const prodEnv = dotenv.config({ path: path.join(__dirname, "../../prod.env") }).parsed;
const PROD_URI =
  prodEnv?.MONGO_URI ||
  "mongodb://yasserziad59_db_user:UHSM9oTJOnPT1r2x@ac-ynhcti6-shard-00-00.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-01.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-02.nenjvkr.mongodb.net:27017/TMS_PROD?ssl=true&replicaSet=atlas-vmtjfi-shard-0&authSource=admin&appName=Cluster0";

async function checkDuplicateMembers() {
  try {
    await mongoose.connect(PROD_URI, { readPreference: "secondaryPreferred" });
    const db = mongoose.connection.db!;
    const usersCollection = db.collection("users");
    const membersCollection = db.collection("members");

    console.log("=== 1. Checking for duplicate UIDs in 'members' collection ===");
    const duplicateMemberGroups = await membersCollection
      .aggregate([
        {
          $group: {
            _id: "$uid",
            count: { $sum: 1 },
            memberDocIds: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    console.log(`Found ${duplicateMemberGroups.length} user(s) with multiple Member documents.`);

    let index = 1;
    for (const group of duplicateMemberGroups) {
      const user = await usersCollection.findOne(
        { _id: group._id },
        { projection: { name: 1, phoneNumber: 1, email: 1, role: 1, createdAt: 1 } }
      );
      const memberDocs = await membersCollection
        .find({ _id: { $in: group.memberDocIds } })
        .sort({ _id: 1 })
        .toArray();

      console.log(
        `\n#${index++} UID: ${group._id} | Name: "${user?.name ?? "N/A"}" | Phone: ${user?.phoneNumber ?? "N/A"} | Email: ${user?.email ?? "N/A"} | Role: ${user?.role ?? "N/A"}`
      );
      for (const m of memberDocs) {
        const pkgSummary = (m.packages ?? [])
          .map((p: any) => `${p.name || "pkg"}(${p.status}, rem:${p.remainingClasses})`)
          .join(", ");
        console.log(
          `   - Member _id: ${m._id} | pkgs: ${m.packages?.length ?? 0} [${pkgSummary}] | bookings: ${m.bookings?.length ?? 0} | att: ${m.attendance?.length ?? 0} | ptAtt: ${m.ptAttendance?.length ?? 0}`
        );
      }
    }

    console.log("\n=== 2. Checking for duplicate phone numbers in 'users' collection ===");
    const duplicatePhoneGroups = await usersCollection
      .aggregate([
        {
          $project: {
            name: 1,
            phoneNumber: 1,
            email: 1,
            role: 1,
            normalizedPhone: {
              $trim: {
                input: {
                  $replaceAll: {
                    input: { $ifNull: ["$phoneNumber", ""] },
                    find: " ",
                    replacement: "",
                  },
                },
              },
            },
          },
        },
        { $match: { normalizedPhone: { $ne: "" } } },
        {
          $group: {
            _id: "$normalizedPhone",
            count: { $sum: 1 },
            users: {
              $push: {
                _id: "$_id",
                name: "$name",
                phoneNumber: "$phoneNumber",
                email: "$email",
                role: "$role",
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    console.log(`Found ${duplicatePhoneGroups.length} phone number(s) shared by multiple User documents.`);
    for (const group of duplicatePhoneGroups) {
      console.log("\nPhone:", group._id, `(${group.count} users):`);
      console.log(group.users);
    }

    console.log("\n=== 3. Checking indexes on 'members' collection ===");
    const indexes = await membersCollection.indexes();
    console.log(indexes);
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

checkDuplicateMembers();
