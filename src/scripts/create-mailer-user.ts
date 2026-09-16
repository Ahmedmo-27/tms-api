import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/user";

dotenv.config();

/**
 * Usage:
 * npx ts-node src/scripts/create-mailer-user.ts <phoneNumber> <password> <name> <email> [tmsEmail] [sendAsName]
 *
 * Example:
 * npx ts-node src/scripts/create-mailer-user.ts 01000000099 Secret12345! "Marketing Team" marketing@example.com marketing@the-mind-space.com "TMS Marketing"
 */
async function main() {
  const [phoneNumber, password, name, email, tmsEmail, sendAsName] = process.argv.slice(2);

  if (!phoneNumber || !password || !name || !email) {
    console.error("Usage: npx ts-node src/scripts/create-mailer-user.ts <phoneNumber> <password> <name> <email> [tmsEmail] [sendAsName]");
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tms_test";
  await mongoose.connect(mongoUri);

  try {
    let user = await User.findOne({ phoneNumber });

    if (user) {
      console.log(`Updating existing user (${phoneNumber}) to mailer role...`);
      user.role = "mailer";
      user.name = name;
      user.email = email;
      user.password = password; // Will be hashed on save
      if (tmsEmail) user.tmsEmail = tmsEmail.trim().toLowerCase();
      if (sendAsName) user.sendAsName = sendAsName.trim();
      await user.save();
      console.log(`User ${user.phoneNumber} successfully updated to role 'mailer'.`);
    } else {
      console.log(`Creating new user (${phoneNumber}) with role 'mailer'...`);
      user = new User({
        phoneNumber,
        password,
        name,
        email,
        role: "mailer",
        tmsEmail: tmsEmail ? tmsEmail.trim().toLowerCase() : undefined,
        sendAsName: sendAsName ? sendAsName.trim() : name,
      });
      await user.save();
      console.log(`User ${user.phoneNumber} successfully created with role 'mailer'.`);
    }

    console.log({
      id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
      tmsEmail: user.tmsEmail,
      sendAsName: user.sendAsName,
    });
  } catch (error) {
    console.error("Error creating/updating mailer user:", error);
  } finally {
    await mongoose.disconnect();
  }
}

main();
