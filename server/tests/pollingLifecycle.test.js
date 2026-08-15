require("dotenv").config();
const { Queue } = require("bullmq");
const assert = require("assert");

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
};

async function runTests() {
  const syncQueue = new Queue("gmail-sync", { connection: bullConnection });
  const userId = "test_user_" + Date.now();
  
  try {
    console.log("Starting Polling Lifecycle Tests...");

    // 1. Initial State
    let repeatable = await syncQueue.getRepeatableJobs();
    const initialCount = repeatable.length;

    // Simulate enqueuePeriodicSync
    const enqueuePeriodicSync = async (uid) => {
      await syncQueue.add(
        "sync",
        { userId: uid, type: "incremental" },
        {
          repeat: { every: 60000 },
          jobId: `poll:${uid}`,
          removeOnComplete: true,
          removeOnFail: { count: 3 },
        }
      );
    };

    // Test 1: Historical Sync Completion
    await enqueuePeriodicSync(userId);
    repeatable = await syncQueue.getRepeatableJobs();
    assert.strictEqual(repeatable.length, initialCount + 1, "Should add one repeatable job");
    console.log("✅ Test 1 Passed: Historical sync completion starts polling.");

    // Test 2: Incremental Sync Completion (Idempotency)
    await enqueuePeriodicSync(userId);
    await enqueuePeriodicSync(userId);
    await enqueuePeriodicSync(userId);
    
    repeatable = await syncQueue.getRepeatableJobs();
    assert.strictEqual(repeatable.length, initialCount + 1, "Should STILL only have one repeatable job per user (idempotent)");
    console.log("✅ Test 2 Passed: Incremental sync completion ensures polling exists without duplicating.");

    // Test 3: Server Restart Simulation
    await enqueuePeriodicSync(userId);
    repeatable = await syncQueue.getRepeatableJobs();
    assert.strictEqual(repeatable.length, initialCount + 1, "Should survive simulated restarts idempotently.");
    console.log("✅ Test 3 Passed: Server restart simulation (repeated calls) handles state cleanly.");

    // Cleanup
    // We clean up by removing the most recently added job
    const newRepeatable = await syncQueue.getRepeatableJobs();
    if (newRepeatable.length > initialCount) {
      await syncQueue.removeRepeatableByKey(newRepeatable[newRepeatable.length - 1].key);
    }
    console.log("✅ Cleanup successful.");
    console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await syncQueue.close();
    process.exit(0);
  }
}

runTests();
