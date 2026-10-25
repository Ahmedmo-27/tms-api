import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/user";

dotenv.config();

/**
 * Creates (or converts) a sales account.
 *
 * "sales" is the account a sold package is credited to; "sales_manager" also
 * owns the sales dashboard, where attribution is set or corrected.
 *
 * Usage:
 * npx ts-node src/scripts/create-sales-user.ts <sales|sales_manager> <phoneNumber> <password> <name> <email>
 *
 * Example:
 * npx ts-node src/scripts/create-sales-user.ts sales_manager 01000000088 Secret12345! "Sales Lead" sales@example.com
 */
async function main() {
  const [role, phoneNumber, password, name, email] = process.argv.slice(2);

  if (
    (role !== "sales" && role !== "sales_manager") ||
    !phoneNumber ||
    !password ||
    !name ||
    !email
  ) {
    console.error(
      "Usage: npx ts-node src/scripts/create-sales-user.ts <sales|sales_manager> <phoneNumber> <password> <name> <email>",
    );
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tms_test";
  await mongoose.connect(mongoUri);

  try {
    let user = await User.findOne({ phoneNumber });

    if (user) {
      console.log(`Updating existing user (${phoneNumber}) to ${role} role...`);
      user.role = role;
      user.name = name;
      user.email = email;
      user.password = password; // hashed on save
      user.locationId = undefined;
      await user.save();
    } else {
      console.log(`Creating new user (${phoneNumber}) with role '${role}'...`);
      user = new User({
        phoneNumber,
        password,
        name,
        email,
        role,
      });
      await user.save();
    }

    console.log({
      id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
    });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
