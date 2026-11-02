import mongoose from "mongoose";
import User from "../models/user";
import { describeMongoTarget, resolveScriptMongoUri } from "./script-db";

/**
 * Creates (or converts) a read-only accountant account.
 *
 * Usage:
 * npx ts-node src/scripts/create-accountant-user.ts <phoneNumber> <password> <name> <email> [tmsEmail]
 *
 * Example:
 * npx ts-node src/scripts/create-accountant-user.ts 01000000077 Secret12345! "Finance Team" finance@example.com finance@the-mind-space.com
 */
async function main() {
  const [phoneNumber, password, name, email, tmsEmail] = process.argv.slice(2);

  if (!phoneNumber || !password || !name || !email) {
    console.error(
      "Usage: npx ts-node src/scripts/create-accountant-user.ts <phoneNumber> <password> <name> <email> [tmsEmail]",
    );
    process.exit(1);
  }

  const mongoUri = resolveScriptMongoUri();
  console.log(`Connecting to ${describeMongoTarget(mongoUri)}...`);
  await mongoose.connect(mongoUri);

  try {
    let user = await User.findOne({ phoneNumber });

    if (user) {
      console.log(`Updating existing user (${phoneNumber}) to accountant role...`);
      user.role = "accountant";
      user.name = name;
      user.email = email;
      user.password = password; // hashed on save
      user.locationId = undefined;
      if (tmsEmail) user.tmsEmail = tmsEmail.trim().toLowerCase();
      await user.save();
    } else {
      console.log(`Creating new user (${phoneNumber}) with role 'accountant'...`);
      user = new User({
        phoneNumber,
        password,
        name,
        email,
        role: "accountant",
        tmsEmail: tmsEmail ? tmsEmail.trim().toLowerCase() : undefined,
        sendAsName: name,
      });
      await user.save();
    }

    console.log({
      id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
      tmsEmail: user.tmsEmail,
    });
  } catch (error) {
    console.error("Error creating/updating accountant user:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
