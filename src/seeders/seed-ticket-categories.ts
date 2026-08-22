import mongoose from "mongoose";
import TicketCategory from "../models/ticketCategory";
import logger from "../config/logger";

// Default problem categories. Admins can edit/add/remove these from the dashboard.
// This seeder is idempotent: it upserts and never wipes existing data.
const DEFAULT_CATEGORIES = [
  "Booking & Scheduling",
  "Membership & Packages",
  "Payments & Billing",
  "App Technical Issue",
  "QR / Check-in",
  "Facility & Cleanliness",
  "Coach / Class Feedback",
];

const seedTicketCategories = async () => {
  const uri = "mongodb://yasserziad59_db_user:UHSM9oTJOnPT1r2x@ac-ynhcti6-shard-00-00.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-01.nenjvkr.mongodb.net:27017,ac-ynhcti6-shard-00-02.nenjvkr.mongodb.net:27017/TMS_PROD?ssl=true&replicaSet=atlas-vmtjfi-shard-0&authSource=admin&appName=Cluster0";
  if (!uri) throw new Error("MONGO_URI is not defined in environment variables");

  await mongoose.connect(uri);
  logger.info("Seeding ticket categories...");

  for (const name of DEFAULT_CATEGORIES) {
    await TicketCategory.updateOne(
      { name },
      { $setOnInsert: { name, isActive: true } },
      { upsert: true }
    );
    console.log(`✓ ensured category: ${name}`);
  }

  await mongoose.disconnect();
};

seedTicketCategories()
  .then(() => {
    console.log("Done seeding ticket categories - Exiting");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Ticket category seeding failed:", error);
    process.exit(1);
  });
