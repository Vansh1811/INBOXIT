// Quick diagnostic — run with: node debug-sync.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/User");
const Email = require("./src/models/Email");

async function diagnose() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB ✅\n");

  // 1. Check users
  const users = await User.find({}).lean();
  console.log(`=== USERS (${users.length}) ===`);
  for (const u of users) {
    console.log(`  ID: ${u._id}`);
    console.log(`  Email: ${u.email}`);
    console.log(`  lastHistoryId: ${u.lastHistoryId || "NONE"}`);
    console.log(`  lastSyncedAt: ${u.lastSyncedAt || "NEVER"}`);
    console.log(`  syncState:`, JSON.stringify(u.syncState || {}));
    console.log(`  tokenExpiry: ${u.tokenExpiry} (${new Date(u.tokenExpiry) > new Date() ? "VALID" : "EXPIRED"})`);
    console.log();
  }

  // 2. Check emails
  const emailCount = await Email.countDocuments();
  console.log(`=== EMAILS ===`);
  console.log(`  Total emails in DB: ${emailCount}`);

  if (emailCount > 0) {
    const sample = await Email.findOne().lean();
    console.log(`  Sample email subject: ${sample?.subject}`);
    console.log(`  Sample email userId: ${sample?.userId}`);
  }

  // 3. Per-user email counts
  for (const u of users) {
    const count = await Email.countDocuments({ userId: u._id });
    console.log(`  Emails for ${u.email}: ${count}`);
  }

  // 4. Fix stuck isSyncing
  const stuck = await User.updateMany(
    { "syncState.isSyncing": true },
    { $set: { "syncState.isSyncing": false } }
  );
  if (stuck.modifiedCount > 0) {
    console.log(`\n🔧 Fixed ${stuck.modifiedCount} user(s) stuck in isSyncing=true`);
  }

  await mongoose.disconnect();
  console.log("\nDone ✅");
}

diagnose().catch(console.error);
