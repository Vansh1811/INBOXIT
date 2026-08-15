require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { Queue } = require("bullmq");
const { runSync } = require("../src/services/emailSyncService");

async function runInvestigate() {
  const MONGO_URI = process.env.MONGO_URI;
  await mongoose.connect(MONGO_URI);
  
  const userId = "69bfa83472996a8e68eab57d";

  const user = await User.findById(userId).lean();
  console.log(JSON.stringify(user.syncState, null, 2));
  console.log("lastHistoryId:", user.lastHistoryId);

  // Directly run the worker logic for this user
  console.log("\n--- TRIGGERING WORKER LOGIC ---");
  const loadedUser = await User.findById(userId);
  console.log(`[Worker] ✅ User: ${loadedUser.email}`);
  
  console.log({
    lastHistoryId: loadedUser.lastHistoryId,
    lastHistoryIdType: typeof loadedUser.lastHistoryId,
    nextPageToken: loadedUser.syncState?.nextPageToken,
    nextPageTokenType: typeof loadedUser.syncState?.nextPageToken,
  });

  try {
    await runSync({ user: loadedUser, syncType: "incremental" });
  } catch (err) {
    console.log("Sync Error:", err.message);
  }

  process.exit(0);
}
runInvestigate();
