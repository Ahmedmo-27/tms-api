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
  const uri = process.env.MONGO_URI;
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
