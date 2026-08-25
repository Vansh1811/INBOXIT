/**
 * Phase 3 queue-lifecycle verification (run against real Redis).
 * Usage: node scripts/verify-queue-phase3.js <arm|check|stop>
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../src/models/User");
const {
  enqueuePeriodicSync,
  stopPeriodicSync,
  isPollerActive,
} = require("../src/queues/syncQueue");
const { syncQueue } = require("../src/queues/syncQueue");

async function main() {
  const mode = process.argv[2];
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({}).select("_id");
  const userId = user._id.toString();

  if (mode === "arm") {
    await enqueuePeriodicSync(userId);
  } else if (mode === "check") {
    const active = await isPollerActive(userId);
    console.log(`POLLER_ACTIVE=${active}`);
  } else if (mode === "stop") {
    const removed = await stopPeriodicSync(userId);
    console.log(`STOPPED=${removed}`);
  } else {
    console.error("usage: arm | check | stop");
  }

  const all = await syncQueue.getRepeatableJobs();
  console.log(`REPEATABLE_TOTAL=${all.length}`);
  await syncQueue.close();
  await mongoose.connection.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
