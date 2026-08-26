/**
 * Phase 5 — partial bulk-action failure isolation (O-C1) verification.
 *
 * Exercises the REAL production functions:
 *   - restrictRollbackToFailedGmailIds  (src/utils/actionRollback.js)
 *   - reconcileLocalAfterFailure        (src/queues/actionWorker.js)
 * against SYNTHETIC documents in MongoDB. No Gmail calls are made.
 *
 * Scenarios (per Phase 5 requirements):
 *   1. all-success bulk            → helper returns null ⇒ no rollback
 *   2. one failed item             → only that item restored
 *   3. multiple failed items       → only those items restored
 *   4. archive item never in INBOX → rollback does NOT fabricate INBOX
 *   5. delete rollback skips already-deleted items (unknown/extra ids safe)
 *   6. legacy mongoIds payload     → still compatible
 *
 * Every scenario runs in try/finally; ALL synthetic state is always removed.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");
const Email = require("../src/models/Email");

const {
  restrictRollbackToFailedGmailIds,
  resolveRollbackIds,
} = require("../src/utils/actionRollback");
const { reconcileLocalAfterFailure } = require("../src/queues/actionWorker");

const MARKER = `phase5-bulk-${Date.now()}`;
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Isolated synthetic user — never a real account
  const { insertedId: userId } = await db.collection("users").insertOne({
    googleId: MARKER,
    email: `${MARKER}@synthetic.invalid`,
    name: "phase5 bulk-partial test",
  });

  /** Seed one email doc; returns { _id, gmailMessageId }. */
  async function seed(gmailMessageId, { labels = ["INBOX"], isDeleted = false } = {}) {
    await db.collection("emails").deleteMany({ gmailMessageId });
    const { insertedId } = await db.collection("emails").insertOne({
      userId,
      gmailMessageId,
      from: "Bulk Tester <t@bulk-test.dev>",
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
    return { id: insertedId.toString(), gmailMessageId };
  }

  const getDoc = (id) => db.collection("emails").findOne({ _id: new (require("mongodb").ObjectId)(id) });
  const cleanupIds = [];

  try {
    // ── Scenario 1: ALL chunks succeed ─────────────────────────────────────
    {
      console.log("\n[1] all-success bulk → no rollback");
      const a = await seed(`${MARKER}-s1-a`);
      const b = await seed(`${MARKER}-s1-b`);
      cleanupIds.push(a.id, b.id);

      const helperOut = await restrictRollbackToFailedGmailIds(
        { userId: userId.toString(), action: "bulk-trash", restoreNotDeletedIds: [a.id, b.id] },
        { userId: userId.toString(), failedGmailIds: [] } // nothing failed
      );
      check("helper returns null when no Gmail ids failed", helperOut === null);

      const beforeA = await getDoc(a.id);
      // Production worker performs NO reconcile on success — prove reconcile
      // with an empty restriction is a no-op (the defensive path):
      await reconcileLocalAfterFailure({
        userId: userId.toString(),
        action: "bulk-trash",
        restoreNotDeletedIds: [],
      });
      const afterA = await getDoc(a.id);
      check("empty restriction mutates nothing", beforeA.isDeleted === afterA.isDeleted);
    }

    // ── Scenario 2: ONE failed item of three ───────────────────────────────
    {
      console.log("\n[2] one failed item → only that item restored");
      const x = await seed(`${MARKER}-s2-x`); // gmail OK
      const y = await seed(`${MARKER}-s2-y`); // gmail OK
      const z = await seed(`${MARKER}-s2-z`); // gmail FAILED
      cleanupIds.push(x.id, y.id, z.id);

      // Exact production deleteEmail optimistic mutation + snapshot
      // (production payloads ALWAYS carry userId — req.user.id)
      const snapIds = [];
      for (const t of [x, y, z]) {
        const pre = await Email.findOneAndUpdate(
          { _id: t.id, isDeleted: false }, { isDeleted: true }
        ).lean();
        snapIds.push(pre._id.toString());
      }
      const snapshot = {
        userId: userId.toString(),
        action: "bulk-trash",
        restoreNotDeletedIds: snapIds,
      };

      const restricted = await restrictRollbackToFailedGmailIds(snapshot, {
        userId: userId.toString(),
        failedGmailIds: [z.gmailMessageId],
      });
      check("restriction scoped to the single failed id", restricted.restoreNotDeletedIds.length === 1);

      await reconcileLocalAfterFailure(restricted);

      const dx = await getDoc(x.id), dy = await getDoc(y.id), dz = await getDoc(z.id);
      check("successful items stay deleted", dx.isDeleted === true && dy.isDeleted === true);
      check("failed item restored", dz.isDeleted === false);
    }

    // ── Scenario 3: MULTIPLE failed items ──────────────────────────────────
    {
      console.log("\n[3] multiple failed items → exactly those restored");
      const p = await seed(`${MARKER}-s3-p`); // ok
      const q1 = await seed(`${MARKER}-s3-q`); // fail
      const r = await seed(`${MARKER}-s3-r`); // ok
      const s = await seed(`${MARKER}-s3-s`); // fail
      cleanupIds.push(p.id, q1.id, r.id, s.id);

      const snapIds = [];
      for (const t of [p, q1, r, s]) {
        const pre = await Email.findOneAndUpdate(
          { _id: t.id, isDeleted: false }, { isDeleted: true }
        ).lean();
        snapIds.push(pre._id.toString());
      }

      const restricted = await restrictRollbackToFailedGmailIds(
        { restoreNotDeletedIds: snapIds },
        { userId: userId.toString(), failedGmailIds: [q1.gmailMessageId, s.gmailMessageId] }
      );
      await reconcileLocalAfterFailure(restricted);

      const dp = await getDoc(p.id), dq = await getDoc(q1.id),
            dr = await getDoc(r.id), ds = await getDoc(s.id);
      check("only failed items restored (p,r stay deleted)",
        dp.isDeleted === true && dr.isDeleted === true &&
        dq.isDeleted === false && ds.isDeleted === false);
    }

    // ── Scenario 4: archive item that was NEVER in INBOX ───────────────────
    {
      console.log("\n[4] archive rollback must not fabricate INBOX");
      const inInbox = await seed(`${MARKER}-s4-in`, { labels: ["INBOX"] });
      const notInInbox = await seed(`${MARKER}-s4-out`, { labels: ["UNREAD"] });
      cleanupIds.push(inInbox.id, notInInbox.id);

      // Mirror production archiveEmail: pull INBOX, snapshot ONLY pre-INBOX members
      for (const t of [inInbox, notInInbox]) {
        await Email.updateOne({ _id: t.id }, { $pull: { labels: "INBOX" } });
      }
      const snapshot = {
        userId: userId.toString(),
        action: "bulk-archive",
        restoreInboxIds: [inInbox.id], // notInInbox was never INBOX → excluded
      };

      // BOTH gmail mutations permanently fail
      const restricted = await restrictRollbackToFailedGmailIds(
        {
          userId: userId.toString(),
          action: "bulk-archive",
          restoreInboxIds: [inInbox.id],
        },
        { failedGmailIds: [inInbox.gmailMessageId, notInInbox.gmailMessageId] }
      );
      await reconcileLocalAfterFailure(restricted);

      const dIn = await getDoc(inInbox.id);
      const dOut = await getDoc(notInInbox.id);
      check("originally-in-Inbox item restored", dIn.labels.includes("INBOX"));
      check("never-in-Inbox item does NOT gain INBOX",
        !dOut.labels.includes("INBOX") && dOut.labels.includes("UNREAD"));
    }

    // ── Scenario 5: delete rollback skips already-deleted / unknown ids ────
    {
      console.log("\n[5] unknown/already-deleted ids cause no unrelated rollback");
      const live = await seed(`${MARKER}-s5-live`); // will be optimistically deleted
      const ghost = await seed(`${MARKER}-s5-ghost`, { isDeleted: true }); // pre-deleted, NOT in snapshot
      cleanupIds.push(live.id, ghost.id);

      // Production filter excludes already-deleted docs from the snapshot:
      const pre = await Email.findOneAndUpdate(
        { _id: live.id, isDeleted: false }, { isDeleted: true }
      ).lean();
      // Production payloads always carry userId — mirror that exactly:
      const snapshot = {
        userId: userId.toString(),
        action: "bulk-trash",
        restoreNotDeletedIds: [pre._id.toString()],
      };

      // Failed gmail ids include BOTH the live item and the ghost's gmail id
      const restricted = await restrictRollbackToFailedGmailIds(snapshot, {
        userId: userId.toString(),
        failedGmailIds: [live.gmailMessageId, ghost.gmailMessageId],
      });
      check("ghost id filtered out by snapshot intersection",
        restricted.restoreNotDeletedIds.length === 1 &&
        restricted.restoreNotDeletedIds[0] === live.id);

      await reconcileLocalAfterFailure(restricted);
      const dl = await getDoc(live.id), dg = await getDoc(ghost.id);
      check("live item restored", dl.isDeleted === false);
      check("pre-existing deleted item untouched (stays deleted)", dg.isDeleted === true);
    }

    // ── Scenario 6: legacy mongoIds payload compatibility ──────────────────
    {
      console.log("\n[6] legacy mongoIds payload via shared helper");
      const l1 = await seed(`${MARKER}-s6-l1`, { isDeleted: true });
      const l2 = await seed(`${MARKER}-s6-l2`, { isDeleted: true });
      cleanupIds.push(l1.id, l2.id);

      const legacyPayload = { action: "bulk-delete", mongoIds: [l1.id, l2.id] };
      const restricted = await restrictRollbackToFailedGmailIds(legacyPayload, {
        userId: userId.toString(),
        failedGmailIds: [l1.gmailMessageId, l2.gmailMessageId],
      });
      check("legacy restriction resolves mongo ids from gmail ids",
        Array.isArray(restricted.mongoIds) && restricted.mongoIds.length === 2);

      await reconcileLocalAfterFailure(restricted);
      const d1 = await getDoc(l1.id), d2 = await getDoc(l2.id);
      check("legacy rollback restored both deletes",
        d1.isDeleted === false && d2.isDeleted === false);
    }

    // ── Scenario 7: userId injection hardening ──────────────────────────────
    {
      console.log("\n[7] helper injects userId when snapshot omits it");
      const h = await seed(`${MARKER}-s7-h`, { isDeleted: true });
      cleanupIds.push(h.id);

      // Snapshot WITHOUT userId (defensive path — production always includes it)
      const restricted = await restrictRollbackToFailedGmailIds(
        { action: "delete", restoreNotDeletedIds: [h.id] },
        { userId: userId.toString(), failedGmailIds: [h.gmailMessageId] }
      );
      check("helper injected userId into restricted payload",
        restricted.userId === userId.toString());

      await reconcileLocalAfterFailure(restricted);
      const dh = await getDoc(h.id);
      check("injected-userId rollback actually restores the doc",
        dh.isDeleted === false);
    }

    // ── Resolver sanity: resolveRollbackIds still honors both conventions ──
    check("resolver keeps snapshot precedence",
      resolveRollbackIds({ action: "delete", restoreNotDeletedIds: ["a"], mongoIds: ["b"] })
        .notDeletedIds.join() === "a");

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    try {
      const oid = require("mongodb").ObjectId;
      const ids = cleanupIds.filter(Boolean).map((id) => new oid(id));
      await db.collection("emails").deleteMany({ _id: { $in: ids } });
      // Guaranteed sweep by marker regardless of bookkeeping
      await db.collection("emails").deleteMany({ subject: { $regex: `^${MARKER}` } });
      await db.collection("users").deleteOne({ _id: userId });
      console.log("🧹 Synthetic user + emails removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
