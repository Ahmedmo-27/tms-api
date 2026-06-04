import User from "../models/user";
import Member from "../models/member";
import Class from "../models/class";
import Package from "../models/package";
import mongoose from "mongoose";
import logger from "../config/logger";
import { cleanupDatabase } from "../test/utils/cleanup";
import path from "path";

const fs = require("fs").promises;

const seed = async () => {
  const db_uri = process.env.MONGO_URI || "";
  await mongoose.connect(db_uri);
  await cleanupDatabase();
  try {
    logger.info("Starting database seeding...");

    // Load JSON files
    const classesPath = path.join(__dirname, "classes.json");
    const packagesPath = path.join(__dirname, "packages.json");
    const membersPath = path.join(__dirname, "members.json");

    const classesData = JSON.parse(await fs.readFile(classesPath, "utf-8"));
    const packagesData = JSON.parse(await fs.readFile(packagesPath, "utf-8"));
    const membersData = JSON.parse(await fs.readFile(membersPath, "utf-8"));

    logger.info(`Loaded ${classesData.length} classes`);
    logger.info(`Loaded ${packagesData.length} packages`);
    logger.info(`Loaded ${membersData.length} members`);

    // ========== SEED CLASSES ==========
    console.log("\n=== Seeding Classes ===");
    const classesMap: { [key: string]: any } = {};
    for (const classData of classesData) {
      const newClass = new Class({
        title: classData.title,
        category: classData.category,
        price: classData.price,
        location: classData.location,
        inPackages: [],
      });
      await newClass.save();
      classesMap[classData.title] = newClass._id;
      console.log(`✓ Created class: ${classData.title}`);
    }

    // ========== SEED PACKAGES ==========
    console.log("\n=== Seeding Packages ===");
    const packagesMap: { [key: string]: any } = {};
    for (const packageData of packagesData) {
      const newPackage = new Package({
        name: packageData.name,
        numberOfSessions: packageData.numberOfSessions,
        category: packageData.category,
        price: packageData.price,
        expiryPeriod: packageData.expiryPeriod,
        opensClasses: [], // Will link relevant classes
      });
      await newPackage.save();
      packagesMap[packageData.name] = newPackage._id;
      console.log(`✓ Created package: ${packageData.name}`);
    }

    // ========== SEED ADMIN USER ==========
    console.log("\n=== Seeding Admin User ===");
    const admin = new User({
      email: "admin@themindspace.com",
      password: "12345678",
      name: "Admin User",
      phoneNumber: "01200000000",
      role: "admin",
    });
    await admin.save();
    console.log(`✓ Created admin: ${admin.name} (${admin.email})`);

    // ========== SEED FD (Facility Director) USER ==========
    console.log("\n=== Seeding FD User ===");
    const fd = new User({
      email: "fd@themindspace.com",
      password: "12345678",
      name: "Facility Director",
      phoneNumber: "01200000001",
      role: "fd",
    });
    await fd.save();
    console.log(`✓ Created FD: ${fd.name} (${fd.email})`);

    // ========== SEED MEMBERS & USERS ==========
    console.log("\n=== Seeding Members & Users ===");
    for (const memberData of membersData) {
      // Create user
      const randomNum = Math.floor(Math.random() * 1000000);
      const user = new User({
        email:
          memberData.email ||
          `${memberData.name.replace(/\s+/g, "").toLowerCase()}${randomNum}@themindspace.com`,
        password: "12345678",
        name: memberData.name,
        phoneNumber: memberData.phoneNumber,
        role: "member",
      });
      await user.save();

      // Create member
      const memberPackages = [];
      for (const pkg of memberData.packages) {
        const packageId = packagesMap[pkg.packageName];
        if (packageId) {
          const startDate = new Date();
          const endDate = new Date();
          endDate.setDate(
            endDate.getDate() + pkg.expiryDays + 30
          );

          memberPackages.push({
            pkgId: new mongoose.Types.ObjectId(),
            name: pkg.packageName,
            pkgStartDate: startDate,
            pkgEndDate: endDate,
            status: pkg.status, // Active, Completed, Expired, Pending
            remainingClasses: pkg.remainingClasses,
          });
        }
      }

      const sampleBookings =
        memberData.email === "mohammed@gmail.com"
          ? [
              {
                scid: classesMap["Pilates Beginner"] || new mongoose.Types.ObjectId(),
                className: "Pilates Beginner",
                coachName: "Coach Sara",
                bookingTime: new Date(),
                classTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
              },
              {
                scid: classesMap["HIIT Class"] || new mongoose.Types.ObjectId(),
                className: "HIIT Class",
                coachName: "Coach Ali",
                bookingTime: new Date(),
                classTime: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
              },
            ]
          : [];

      const sampleAttendance =
        memberData.email === "mohammed@gmail.com"
          ? [
              {
                scid: classesMap["Yoga Beginner"] || new mongoose.Types.ObjectId(),
                className: "Yoga Beginner",
                date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                classDeducted: true,
              },
              {
                scid: classesMap["Personal Training Session"] || new mongoose.Types.ObjectId(),
                className: "Personal Training Session",
                date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                classDeducted: false,
              },
            ]
          : [];

      const member = new Member({
        uid: user._id,
        name: memberData.name,
        phoneNumber: memberData.phoneNumber,
        packages: memberPackages,
        bookings: sampleBookings,
        attendance: sampleAttendance,
      });
      await member.save();
      console.log(`✓ Created member: ${memberData.name} (${memberData.phoneNumber})`);
    }

    console.log("\n=== Seeding Complete ===");
    console.log(`✓ Total Classes: ${Object.keys(classesMap).length}`);
    console.log(`✓ Total Packages: ${Object.keys(packagesMap).length}`);
    console.log(`✓ Total Members: ${membersData.length}`);
    console.log(`✓ Total Users (including admin & fd): ${membersData.length + 2}`);
    console.log("\nDefault Password: 12345678\n");

    return;
  } catch (error) {
    console.error("Seeding Error:", error);
    return;
  }
};

seed()
  .then(() => {
    console.log("Done seeding - Exiting");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seeding Failed:", error);
    process.exit(1);
  });
