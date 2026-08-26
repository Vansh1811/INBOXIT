require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { connectDB } = require("../src/config/db");
const { syncQueue, enqueuePeriodicSync } = require("../src/queues/syncQueue");
const { redisClient } = require("../src/config/redis");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const userId = "69bfa83472996a8e68eab57d"; // dummy user
  
  console.log("Setting idle polls to 31 (mocking stop)");
  await User.findByIdAndUpdate(userId, { $set: { "syncState.idlePolls": 31 } });
  
  // mock route: POST /sync
  console.log("Mocking POST /sync execution...");
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: { "syncState.idlePolls": 0 } },
    { returnDocument: "after" }
  );
  
  console.log("idlePolls after manual trigger:", updatedUser.syncState.idlePolls);
  
  // mock worker sync execution returning empty
  const empty = true;
  if (empty) {
    updatedUser.syncState.idlePolls += 1;
    await updatedUser.save();
  }
  
  console.log("idlePolls after 0-result sync:", updatedUser.syncState.idlePolls);
  
  if (updatedUser.syncState.idlePolls < 30) {
    console.log("✅ Periodic sync is successfully re-armed!");
  } else {
    console.error("❌ Periodic sync failed to re-arm.");
  }
  
  process.exit(0);
}
main();
