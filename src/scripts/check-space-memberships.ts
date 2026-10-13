import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import Package from "../models/package";
import Class from "../models/class";
import Payment from "../models/payment";
import Member from "../models/member";

const EXPECTED_SPACE_PRICE_LIST = [
  { duration: "1 Day (Drop-In)", targetPrice: 450, type: "CLASS", notes: "Open Gym Drop-In class" },
  { duration: "1 Month", targetPrice: 3000, targetExpiry: 30, targetFreeze: 7, notes: "1 week freeze" },
  { duration: "3 Months", targetPrice: 7200, targetExpiry: 90, targetFreeze: 14, notes: "2 weeks freeze" },
  { duration: "6 Months", targetPrice: 12500, targetExpiry: 180, targetFreeze: 21, notes: "3 weeks freeze" },
  { duration: "1 Year", targetPrice: 20500, targetExpiry: 365, targetFreeze: 42, notes: "6 weeks freeze" },
];

async function main() {
  const isProd = !process.argv.includes("--dev");
  const envFile = isProd ? "prod.env" : "dev.env";
  dotenv.config({ path: path.join(__dirname, `../../${envFile}`) });

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`❌ MONGO_URI not found in ${envFile}!`);
    process.exit(1);
  }

  console.log(`\n======================================================================`);
  console.log(` SPACE MEMBERSHIP AUDIT REPORT [READ-ONLY]`);
  console.log(` Target Environment: ${envFile}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================================\n`);

  await mongoose.connect(uri, { readPreference: "primaryPreferred" });

  // -------------------------------------------------------------------------
  // 1. OPEN GYM DROP-IN CLASS (1 DAY)
  // -------------------------------------------------------------------------
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`1. 1-DAY OPEN GYM DROP-IN CLASSES (Expected: 450 EGP for Cairo)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const workspaceClasses = await Class.find({
    $or: [{ category: "WORKSPACE" }, { title: /open gym/i }],
  }).lean();

  if (workspaceClasses.length === 0) {
    console.log(`  ⚠️ No Workspace / Open Gym classes found!`);
  } else {
    for (const c of workspaceClasses) {
      const isPriceMatch = (c as any).price === 450;
      const statusIcon = isPriceMatch ? "✅" : "⚠️";
      console.log(
        `  ${statusIcon} [${c._id}] "${(c as any).title}" | Price: ${(c as any).price} EGP (Expected: 450) | Category: ${(c as any).category} | allowDropIn: ${(c as any).allowDropIn}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. SPACE MEMBERSHIP CATALOG PACKAGES
  // -------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`2. SPACE MEMBERSHIP CATALOG PACKAGES`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const spacePackages = await Package.find({
    $or: [
      { category: "SPACE_MEMBERSHIP" },
      { category: "OPEN_GYM" },
      { name: /space membership/i },
      { name: /open gym/i },
      { name: /whole summer space/i },
    ],
  }).lean();

  const activeSpacePkgs = spacePackages.filter((p) => !p.isDeprecated);
  const deprecatedSpacePkgs = spacePackages.filter((p) => p.isDeprecated);

  console.log(`Found ${spacePackages.length} total Space/Open Gym packages in DB:`);
  console.log(`  - Active (not deprecated): ${activeSpacePkgs.length}`);
  console.log(`  - Deprecated / Archived:   ${deprecatedSpacePkgs.length}\n`);

  console.log(`── ACTIVE PACKAGES ──`);
  let hasPriceVulnerability = false;

  for (const p of activeSpacePkgs) {
    // Check match against official price list
    let priceMatchNote = "";
    if (p.expiryPeriod <= 35) {
      if (p.price === 3000) priceMatchNote = "✅ Matches 1-Month price (3,000 EGP)";
      else {
        priceMatchNote = `🚨 OLD/MISMATCHED PRICE! (Is: ${p.price} EGP, Expected: 3,000 EGP)`;
        hasPriceVulnerability = true;
      }
    } else if (p.expiryPeriod <= 100) {
      if (p.price === 7200) priceMatchNote = "✅ Matches 3-Months price (7,200 EGP)";
      else {
        priceMatchNote = `🚨 OLD/MISMATCHED PRICE! (Is: ${p.price} EGP, Expected: 7,200 EGP)`;
        hasPriceVulnerability = true;
      }
    } else if (p.expiryPeriod <= 200) {
      if (p.price === 12500) priceMatchNote = "✅ Matches 6-Months price (12,500 EGP)";
      else {
        priceMatchNote = `🚨 OLD/MISMATCHED PRICE! (Is: ${p.price} EGP, Expected: 12,500 EGP)`;
        hasPriceVulnerability = true;
      }
    } else if (p.expiryPeriod >= 300) {
      if (p.price === 20500) priceMatchNote = "✅ Matches 1-Year price (20,500 EGP)";
      else {
        priceMatchNote = `🚨 OLD/MISMATCHED PRICE! (Is: ${p.price} EGP, Expected: 20,500 EGP)`;
        hasPriceVulnerability = true;
      }
    } else {
      priceMatchNote = `ℹ️ Non-standard duration (${p.expiryPeriod} days)`;
    }

    const freezeStatus =
      p.allowedFreezeDays !== undefined ? `${p.allowedFreezeDays}d freeze` : "no freeze set";
    const visibility = p.hidden ? "👁️‍🗨️ HIDDEN" : "👁️ VISIBLE";

    console.log(`  [ID: ${p._id}] "${p.name}"`);
    console.log(`     Price: ${p.price} EGP | Expiry: ${p.expiryPeriod}d | ${freezeStatus} | Category: ${p.category} | ${visibility}`);
    console.log(`     Audit: ${priceMatchNote}`);
    if (p.hidden && !p.isDeprecated) {
      console.log(`     ⚠️ WARNING: Package is hidden but NOT deprecated! Front desk / direct API CAN still sell it!`);
    }
    console.log(``);
  }

  if (deprecatedSpacePkgs.length > 0) {
    console.log(`── DEPRECATED / ARCHIVED PACKAGES (${deprecatedSpacePkgs.length}) ──`);
    for (const p of deprecatedSpacePkgs) {
      console.log(`  🔒 [ID: ${p._id}] "${p.name}" | Price: ${p.price} EGP | Expiry: ${p.expiryPeriod}d | isDeprecated: true`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. SUBSCRIBER STATS
  // -------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`3. ACTIVE MEMBER SUBSCRIPTIONS`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const spacePkgIds = spacePackages.map((p) => p._id);
  const activeSubscribers = await Member.countDocuments({
    packages: {
      $elemMatch: {
        pkgId: { $in: spacePkgIds },
        status: { $in: ["ACTIVE", "FROZEN"] },
      },
    },
  });

  console.log(`  Total members with an ACTIVE or FROZEN Space Membership: ${activeSubscribers}`);

  // -------------------------------------------------------------------------
  // 4. RECENT PAYMENT TRANSACTIONS (Detect purchases at old prices)
  // -------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`4. RECENT SPACE MEMBERSHIP PAYMENTS (Last 15 Transactions)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const recentPayments = await Payment.find({
    pkgId: { $in: spacePkgIds },
  })
    .sort({ paymentTime: -1 })
    .limit(15)
    .lean();

  if (recentPayments.length === 0) {
    console.log(`  No recent payments found for Space Membership.`);
  } else {
    for (const pay of recentPayments) {
      const pkg = spacePackages.find((p) => p._id.toString() === pay.pkgId?.toString());
      const dateStr = pay.paymentTime ? new Date(pay.paymentTime).toLocaleString() : "Unknown";
      const pkgName = pkg ? `"${pkg.name}" (${pkg.expiryPeriod}d)` : `pkgId: ${pay.pkgId}`;

      // Highlight if bought at old price
      let alertFlag = "";
      if (pkg?.expiryPeriod === 30 && pay.amount === 2750) alertFlag = "🚨 [OLD PRICE: 2750]";
      else if (pkg?.expiryPeriod === 90 && pay.amount === 6850) alertFlag = "🚨 [OLD PRICE: 6850]";
      else if (pkg?.expiryPeriod === 180 && pay.amount === 12000) alertFlag = "🚨 [OLD PRICE: 12000]";
      else if ((pkg?.expiryPeriod === 360 || pkg?.expiryPeriod === 365) && pay.amount === 19900) alertFlag = "🚨 [OLD PRICE: 19900]";

      console.log(`  ${dateStr} | ${pay.amount} EGP | Method: ${pay.paymentMethod} | ${pkgName} ${alertFlag}`);
    }
  }

  // -------------------------------------------------------------------------
  // 5. SUMMARY VERDICT
  // -------------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`5. AUDIT VERDICT`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (hasPriceVulnerability) {
    console.log(`❌ VULNERABILITY DETECTED: Active Space Membership packages still have OLD PRICES.`);
    console.log(`   Customers or staff can purchase at old prices.`);
    console.log(`   Fix: Run 'npm run update-prices:apply' to update packages and deprecate obsolete ones.`);
  } else {
    console.log(`✅ ALL CLEAR: All active Space Membership packages are aligned with the official price list!`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
