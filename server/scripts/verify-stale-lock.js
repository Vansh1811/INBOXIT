/**
 * Phase 3 FIX 3 — stale-lock ownership verification (SAFE).
 *
 * Replicates the EXACT production queries from src/queues/syncWorker.js
 * against a SYNTHETIC user created solely for this script:
 *
 *   Job A acquires lock        → activeJobId = "JobA"
 *   A's startedAt goes stale   → (simulated via backdated syncStartedAt)
 *   Job B CAS-acquires         → activeJobId = "JobB"
 *   A's delayed success/error
 *   release runs               → MUST NOT clear B's lock
 *
 * All mutations are wrapped in try/finally; the synthetic user is ALWAYS
 * deleted. The real user collection is never touched.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");
const User = require("../src/models/User");

const GOOGLE_ID = `phase3-stale-lock-${Date.now()}`;
let passed = 0;
let failed = 0;

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  // Exact copies of the production queries in syncWorker.js
  const acquireLock = (userId, jobId) =>
    User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { "syncState.isSyncing": { $ne: true } },
          { "syncState.syncStartedAt": { $lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      {
        $set: {
          "syncState.isSyncing": true,
          "syncState.syncStartedAt": new Date(),
          "syncState.activeJobId": jobId,
        },
      },
      { new: true }
    );

  const releaseIfOwner = (userId, jobId) =>
    User.updateOne(
      { _id: userId, "syncState.activeJobId": jobId },
      { $set: { "syncState.isSyncing": false, "syncState.activeJobId": null } }
    );

  let synthetic = null;
  try {
    synthetic = await User.create({
      googleId: GOOGLE_ID,
      email: `${GOOGLE_ID}@synthetic.invalid`,
      name: "Phase3 stale-lock test",
    });
    const uid = synthetic._id;

    // 1. Job A acquires
    const a = await acquireLock(uid, "JobA");
    assert.ok(a, "Job A must acquire the free lock");
    assert.strictEqual(a.syncState.activeJobId, "JobA");

    // 2. Simulate A running long: backdate its start past the stale threshold
    await User.updateOne(
      { _id: uid },
      { $set: { "syncState.syncStartedAt": new Date(Date.now() - 15 * 60 * 1000) } }
    );

    // 3. Job B attempts acquisition → stale takeover must succeed
    const b = await acquireLock(uid, "JobB");
    assert.ok(b, "Job B must acquire the stale lock");
    assert.strictEqual(b.syncState.activeJobId, "JobB");
    console.log("✅ B took over stale lock from A (activeJobId=JobB)");
    passed++;

    // 4. Job A's DELAYED success-path cleanup finally fires.
    //    Production shape: release + stats write, guarded by activeJobId.
    await User.updateOne(
      { _id: uid, "syncState.activeJobId": "JobA" },
      {
        $set: {
          "syncState.isSyncing": false,
          "syncState.activeJobId": null,
          lastSyncedAt: new Date(),
        },
      }
    );

    const afterA = await User.findById(uid).select("syncState");
    assert.strictEqual(afterA.syncState.isSyncing, true, "B's lock must survive A's late cleanup");
    assert.strictEqual(afterA.syncState.activeJobId, "JobB", "activeJobId must still be JobB");
    console.log("✅ A's delayed cleanup could not clear B's lock (ownership guard held)");
    passed++;

    // 5. Sanity: B CAN release its own lock
    const rel = await releaseIfOwner(uid, "JobB");
    assert.strictEqual(rel.matchedCount, 1, "owner release must match");
    const afterB = await User.findById(uid).select("syncState");
    assert.strictEqual(afterB.syncState.isSyncing, false);
    assert.strictEqual(afterB.syncState.activeJobId, null);
    console.log("✅ Owner (B) released its own lock normally");
    passed++;
  } catch (e) {
    failed++;
    console.error(`❌ STALE-LOCK TEST FAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    // ALWAYS remove the synthetic user — no lock state is ever left behind
    try {
      if (synthetic?._id) {
        await User.deleteOne({ _id: synthetic._id });
      } else {
        await User.deleteMany({ googleId: GOOGLE_ID });
      }
      console.log("🧹 Synthetic test user removed");
    } catch (e) {
      console.error("⚠️ Cleanup error:", e.message);
      process.exitCode = process.exitCode || 1;
    }
    await mongoose.connection.close().catch(() => {});
  }

  console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
}

run();
