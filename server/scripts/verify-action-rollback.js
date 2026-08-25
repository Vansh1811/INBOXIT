/**
 * Phase 3 FIX 2 — action rollback verification.
 *
 * Exercises the ACTUAL production reconciliation implementation
 * (`reconcileLocalAfterFailure` exported from src/queues/actionWorker.js)
 * against isolated synthetic documents. No Gmail calls are made.
 *
 * Scenarios:
 *   ARCHIVE + had INBOX        → INBOX restored
 *   ARCHIVE + had NO INBOX     → snapshot empty → INBOX NOT fabricated
 *   DELETE  (exact optimistic mutation used by deleteEmail)
 *                              → isDeleted restored to false
 *
 * All mutations are wrapped in try/finally; synthetic docs are ALWAYS removed.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");
const User = require("../src/models/User");
const Email = require("../src/models/Email");
const { reconcileLocalAfterFailure } = require("../src/queues/actionWorker");

const MARKER = "phase3fix-rollback-test";
let passed = 0;
let failed = 0;

async function seedEmail(db, gmailMessageId, labels, isDeleted) {
  const user = await User.findOne({}).select("_id");
  await db.collection("emails").deleteMany({ gmailMessageId });
  const { insertedId } = await db.collection("emails").insertOne({
    userId: user._id,
    gmailMessageId,
    from: "Rollback Tester <t@rollback-test.dev>",
    subject: `${MARKER} ${gmailMessageId}`,
    snippet: "synthetic",
    receivedAt: new Date(),
    category: "uncategorized",
    userOverride: false,
    isRead: true,
    isStarred: false,
    isDeleted,
    labels,
  });
  return { userId: user._id.toString(), insertedId };
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // ── ARCHIVE case 1: originally had INBOX → restore it ────────────────────
  {
    const g = `${MARKER}-arch-had-inbox`;
    try {
      const { userId, insertedId } = await seedEmail(db, g, ["INBOX", "UNREAD"], false);
      // Mirror production archiveEmail optimistic mutation ($pull INBOX)
      await Email.updateOne({ _id: insertedId }, { $pull: { labels: "INBOX" } });

      // Production reconciliation with the snapshot archiveEmail would build
      await reconcileLocalAfterFailure({
        userId,
        action: "archive",
        restoreInboxIds: [insertedId.toString()],
      });

      const doc = await Email.findById(insertedId);
      assert.ok(doc.labels.includes("INBOX"), "INBOX must be restored");
      console.log(`✅ ARCHIVE had-INBOX: restored (${g})`);
      passed++;
    } catch (e) {
      failed++;
      console.error(`❌ ARCHIVE had-INBOX FAILED: ${e.message}`);
    } finally {
      await db.collection("emails").deleteMany({ gmailMessageId: g });
    }
  }

  // ── ARCHIVE case 2: originally had NO INBOX → must NOT fabricate ─────────
  {
    const g = `${MARKER}-arch-no-inbox`;
    try {
      const { userId, insertedId } = await seedEmail(db, g, ["UNREAD"], false);
      // Production archiveEmail on an already-archived mail builds an EMPTY snapshot
      await reconcileLocalAfterFailure({
        userId,
        action: "archive",
        restoreInboxIds: [],
      });

      const doc = await Email.findById(insertedId);
      assert.ok(!doc.labels.includes("INBOX"), "INBOX must NOT be fabricated");
      assert.strictEqual(doc.isDeleted, false);
      console.log(`✅ ARCHIVE no-INBOX: nothing fabricated (${g})`);
      passed++;
    } catch (e) {
      failed++;
      console.error(`❌ ARCHIVE no-INBOX FAILED: ${e.message}`);
    } finally {
      await db.collection("emails").deleteMany({ gmailMessageId: g });
    }
  }

  // ── DELETE: exact optimistic mutation from production deleteEmail ────────
  {
    const g = `${MARKER}-delete`;
    try {
      const { userId, insertedId } = await seedEmail(db, g, ["INBOX"], false);

      // EXACT production deleteEmail mutation:
      //   findOneAndUpdate({_id, userId, isDeleted:false}, {isDeleted:true})
      const mutated = await Email.findOneAndUpdate(
        { _id: insertedId, isDeleted: false },
        { isDeleted: true },
        { new: false } // production uses pre-update doc for the snapshot
      );
      assert.ok(mutated, "optimistic mutation must match a non-deleted doc");
      assert.strictEqual(mutated.isDeleted, false, "snapshot source must be the PRE-action doc");
      assert.strictEqual(mutated.labels.includes("INBOX"), true);

      // Snapshot exactly as deleteEmail builds it
      await reconcileLocalAfterFailure({
        userId,
        action: "delete",
        restoreNotDeletedIds: [mutated._id.toString()],
      });

      const doc = await Email.findById(insertedId);
      assert.strictEqual(doc.isDeleted, false, "isDeleted must be restored after final failure");
      assert.strictEqual(doc.labels.includes("INBOX"), true, "labels untouched by delete rollback");
      console.log(`✅ DELETE: production reconciliation ran and restored state (${g})`);
      passed++;
    } catch (e) {
      failed++;
      console.error(`❌ DELETE FAILED: ${e.message}`);
    } finally {
      await db.collection("emails").deleteMany({ gmailMessageId: g });
    }
  }

  // ── LEGACY payload compat (Phase 2 mongoIds shape) ────────────────────────
  {
    const g = `${MARKER}-legacy-delete`;
    try {
      const { userId, insertedId } = await seedEmail(db, g, [], true);

      // Legacy Phase 3-early job payload: mongoIds instead of restore*Ids
      await reconcileLocalAfterFailure({
        userId,
        action: "delete",
        mongoIds: [insertedId.toString()],
      });

      const doc = await Email.findById(insertedId);
      assert.strictEqual(doc.isDeleted, false, "legacy mongoIds payload must still revert");
      console.log(`✅ LEGACY mongoIds delete: reverted (${g})`);
      passed++;
    } catch (e) {
      failed++;
      console.error(`❌ LEGACY compat FAILED: ${e.message}`);
    } finally {
      await db.collection("emails").deleteMany({ gmailMessageId: g });
    }
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Guaranteed sweep of every synthetic doc regardless of failures above
    try {
      await mongoose.connection.db
        .collection("emails")
        .deleteMany({ gmailMessageId: { $regex: `^${MARKER}` } });
    } catch {}
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
