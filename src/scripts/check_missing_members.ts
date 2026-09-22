import mongoose from "mongoose";

const PROD_URI = "mongodb://yasserziad59_db_user:UHSM9oTJOnPT1r2x@ac-ynhcti6-shard-00-00.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-01.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-02.nenjvkr.mongodb.net:27017/TMS_PROD?ssl=true&replicaSet=atlas-vmtjfi-shard-0&authSource=admin&appName=Cluster0";

async function checkMissingMembers() {
  try {
    await mongoose.connect(PROD_URI);
    const db = mongoose.connection.db!;
    const usersCollection = db.collection("users");
    const membersCollection = db.collection("members");

    const usersWithMemberRole = await usersCollection.find({ role: "member" }).toArray();
    console.log(`Total users with role 'member': ${usersWithMemberRole.length}`);

    let missingCount = 0;
    const missingUsers = [];
    for (const u of usersWithMemberRole) {
      const memberDoc = await membersCollection.findOne({ uid: u._id });
      if (!memberDoc) {
        missingCount++;
        missingUsers.push({ id: u._id, name: u.name, phone: u.phoneNumber });
      }
    }
    console.log(`Users with role 'member' but NO Member doc: ${missingCount}`);
    if (missingCount > 0) {
      console.log("Sample missing:", missingUsers.slice(0, 10));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

checkMissingMembers();
