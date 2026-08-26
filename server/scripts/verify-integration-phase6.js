/**
 * Phase 6 — integration verification across subsystem boundaries.
 *
 * Exercises REAL production code paths against live MongoDB + Redis:
 *   - controllers/emailController.js handlers (list/archive/delete/update/
 *     cancel) with the BullMQ queue boundary STUBBED (jobs captured, never
 *     sent to Gmail)
 *   - queues/actionWorker.js reconcileLocalAfterFailure + O-C1 restriction
 *   - queues/syncQueue.js poller arm/stop (synthetic user id)
 *
 * Everything uses a unique synthetic user and cleans up in finally.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// ── Stub the action queue boundary BEFORE loading the controller ────────────
const capturedJobs = [];
let fakeJobState = "delayed"; // cancelAction scenario flips this
const actionQueuePath = require.resolve("../src/queues/actionQueue");
require(actionQueuePath);
// Stub mirrors production job payload shape, keyed by jobId, so the
// controller's cancel/revert logic runs against REAL data structures.
const jobsById = {};
let fakeRemoved = 0;
require.cache[actionQueuePath].exports = {
  actionQueue: {
    getJob: async (jobId) => ({
      id: jobId,
      getState: async () => fakeJobState,
      remove: async () => { fakeRemoved++; },
      data: jobsById[jobId] || {},
    }),
  },
  enqueueActionJob: async (userId, emailKey, gmailIds, action, snapshot) => {
    const jobId = `action:${userId}:${emailKey}`;
    jobsById[jobId] = {
      userId, emailId: emailKey, gmailMessageId: gmailIds, action,
      ...(snapshot || {}),
    };
    capturedJobs.push({ jobId, userId, emailKey, gmailIds, action, snapshot });
    return jobId;
  },
};

const Email = require("../src/models/Email");
const { getEmails, archiveEmail, deleteEmail, updateEmail, cancelAction } =
  require("../src/controllers/emailController");
const {
  restrictRollbackToFailedGmailIds,
} = require("../src/utils/actionRollback");
const { reconcileLocalAfterFailure } = require("../src/queues/actionWorker");
const { scanAndDelete } = require("../src/utils/cacheBust");
const { redisClient } = require("../src/config/redis");
const { enqueuePeriodicSync, stopPeriodicSync, isPollerActive } =
  require("../src/queues/syncQueue");

const MARKER = `phase6-int-${Date.now()}`;
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── Fabricated req/res for real controller handlers ─────────────────────────
function makeReq(userId, query = {}, params = {}, body = {}) {
  return {
    id: crypto.randomUUID(),
    user: { id: userId },
    query, params, body,
    headers: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
}
function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(handler, userId, { query = {}, params = {}, body = {} } = {}) {
  const res = makeRes();
  await handler(makeReq(userId, query, params, body), res, () => {});
  return { status: res.statusCode, body: res.body };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // ── Synthetic identity ──────────────────────────────────────────────────
  const G = MARKER;
  const { insertedId: uid } = await db.collection("users").insertOne({
    googleId: G,
    email: `${G}@synthetic.invalid`,
    name: "phase6 integration",
    accessToken: "synthetic", refreshToken: "synthetic",
    tokenExpiry: new Date(Date.now() + 3600e3),
  });
  const uidStr = uid.toString();
  const token = jwt.sign({ id: uidStr }, process.env.JWT_SECRET, { expiresIn: "30m" });
  void token;

  /** Seed an inbox email with a controlled timestamp. */
  async function seed(n, receivedAt, extra = {}) {
    const doc = {
      userId: uid, gmailMessageId: `${G}-${n}`, threadId: `${G}-t${n}`,
      from: `s${n}@test.dev`, to: "me@test.dev", subject: `${MARKER} #${n}`,
      snippet: `snippet ${n}`, bodyHtml: "", bodyText: `body ${n}`,
      receivedAt, category: n % 3 === 0 ? "finance" : "uncategorized",
      userOverride: false, isRead: true, isStarred: false,
      isDeleted: false, labels: ["INBOX"], ...extra,
    };
    await db.collection("emails").deleteMany({ gmailMessageId: doc.gmailMessageId });
    const { insertedId } = await db.collection("emails").insertOne(doc);
    return { id: insertedId.toString(), gm: doc.gmailMessageId, ...doc };
  }

  const keysForUser = async () => {
    let cursor = "0"; const found = [];
    do {
      const [next, k] = await redisClient.scan(cursor, "MATCH", `user:${uidStr}:*`, "COUNT", 200);
      cursor = next; found.push(...k);
    } while (cursor !== "0");
    return found;
  };

  try {
    // ══ SCENARIO A — new mail during cursor pagination ══════════════════════
    console.log("\n[A] pagination + newly synced mail");
    const base = Date.UTC(2026, 5, 1);
    const seeded = [];
    for (let i = 0; i < 45; i++) seeded.push(await seed(`a${i}`, new Date(base + i * 60000)));

    let r = await call(getEmails, uidStr, { query: { folder: "inbox", limit: "20" } });
    check("A.page1 size=20 & hasMore", r.body.emails.length === 20 && r.body.pagination.hasMore === true);
    const page1Ids = r.body.emails.map((e) => e._id);
    const cur1 = r.body.pagination.nextCursor;

    // New mail arrives AFTER page 1 was served
    await seed("NEW", new Date(base + 999 * 60000));
    // Direct-DB writes bypass app-level invalidation; replicate exactly what
    // syncWorker does after a successful sync (SCAN-based bust):
    await scanAndDelete(redisClient, `user:${uidStr}:*`);

    r = await call(getEmails, uidStr, { query: { folder: "inbox", limit: "20", cursor: cur1 } });
    const page2Ids = r.body.emails.map((e) => e._id);
    check("A.page2 has no duplicate of page1", !page2Ids.some((id) => page1Ids.includes(id)));
    check("A.page2 excludes the late arrival (cursor stability)",
      !r.body.emails.some((e) => e.subject === `${MARKER} #NEW`));
    const dupFreeUnion = new Set([...page1Ids, ...page2Ids]).size === 40;
    check("A.pages 1+2 union = 40 distinct ids", dupFreeUnion);

    // Fresh first-page traversal must surface the new arrival at head
    r = await call(getEmails, uidStr, { query: { folder: "inbox", limit: "20" } });
    check("A.fresh traversal shows newest mail first",
      r.body.emails[0].subject === `${MARKER} #NEW`);
    // cleanup the late arrival so later scenarios have deterministic totals
    await db.collection("emails").deleteMany({ gmailMessageId: `${G}-NEW` });
    await scanAndDelete(redisClient, `user:${uidStr}:*`);

    // ══ SCENARIO B — archive via controller + cache/listing consistency ═════
    console.log("\n[B] archive action + cache invalidation");
    const target = seeded[7];
    await call(getEmails, uidStr, { query: { folder: "inbox", limit: "20" } }); // warm cache
    const keysBeforeArchive = (await keysForUser()).length;

    r = await call(archiveEmail, uidStr, { params: { id: target.id } });
    check("B.archive accepted (queued)", r.status === 200);
    check("B.job captured at queue boundary w/ snapshot",
      capturedJobs.length === 1 &&
      capturedJobs[0].action === "archive" &&
      Array.isArray(capturedJobs[0].snapshot.restoreInboxIds));

    const keysAfterArchive = (await keysForUser()).length;
    check("B.folder cache invalidated by mutation", keysAfterArchive === 0,
      `before=${keysBeforeArchive} after=${keysAfterArchive}`);

    const afterArch = await call(getEmails, uidStr, { query: { folder: "inbox", limit: "50" } });
    check("B.fresh listing excludes archived row",
      !afterArch.body.emails.some((e) => e._id === target.id));
    check("B.totalCount reflects removal",
      afterArch.body.pagination.total === seeded.length - 1);

    // Restore for later scenarios (mirror what rollback would do) + verify
    await Email.updateOne({ _id: target.id }, { $addToSet: { labels: "INBOX" } });

    // ══ SCENARIO C — partial bulk failure + final listing state ═════════════
    console.log("\n[C] partial bulk failure → precise rollback + cache");
    const okA = seeded[10], okB = seeded[11], failC = seeded[12];
    const snapIds = [];
    for (const t of [okA, okB, failC]) {
      const pre = await Email.findOneAndUpdate(
        { _id: t.id, isDeleted: false }, { isDeleted: true }, { new: false }
      ).lean();
      snapIds.push(pre._id.toString());
    }
    // Warm the cache so we can prove the post-rollback invalidation fix:
    await call(getEmails, uidStr, { query: { folder: "trash", limit: "20" } });
    check("C.pre-condition: trash cache warmed", (await keysForUser()).length > 0);

    const rollbackData = await restrictRollbackToFailedGmailIds(
      {
        userId: uidStr, action: "bulk-trash",
        restoreNotDeletedIds: snapIds,
      },
      { failedGmailIds: [failC.gm] } // only C's Gmail mutation failed
    );
    const rec = await reconcileLocalAfterFailure(rollbackData);
    check("C.reconcile reported actual reverts", rec.reverted >= 1, JSON.stringify(rec));

    check("C.rollback busted folder cache (Phase 6 fix)", (await keysForUser()).length === 0);

    const dOkA = await db.collection("emails").findOne({ _id: new (require("mongodb").ObjectId)(okA.id) });
    const dOkB = await db.collection("emails").findOne({ _id: new (require("mongodb").ObjectId)(okB.id) });
    const dC = await db.collection("emails").findOne({ _id: new (require("mongodb").ObjectId)(failC.id) });
    check("C.successful deletes remain applied", dOkA.isDeleted === true && dOkB.isDeleted === true);
    check("C.failed item restored to exact pre-action state",
      dC.isDeleted === false && dC.labels.includes("INBOX"));

    const listC = await call(getEmails, uidStr, { query: { folder: "trash", limit: "20" } });
    check("C.listing reflects final Mongo state immediately",
      !listC.body.emails.some((e) => e._id === failC.id));
    // restore C so scenario D starts clean
    await Email.updateOne({ _id: failC.id }, { isDeleted: false });

    // ══ SCENARIO D — update/star + undo-cancel seams ════════════════════════
    console.log("\n[D] update + undo-cancel consistency");
    const star = seeded[20];
    await call(getEmails, uidStr, { query: { folder: "inbox", limit: "20" } }); // warm
    r = await call(updateEmail, uidStr, { params: { id: star.id }, body: { isStarred: true } });
    check("D.star update accepted", r.status === 200 && r.body.isStarred === true);
    check("D.cache busted after update", (await keysForUser()).length === 0);

    // undo-cancel through real controller with stubbed queue job
    fakeRemoved = 0;
    const delTarget = seeded[21];
    r = await call(deleteEmail, uidStr, { params: { id: delTarget.id } });
    check("D.delete queued optimistically", r.status === 200);
    check("D.delete busted cache again", (await keysForUser()).length === 0);

    r = await call(cancelAction, uidStr, { params: { id: delTarget.id }, body: {} });
    check("D.undo cancelled within window", r.status === 200);
    check("D.stubbed queue job removed exactly once", fakeRemoved === 1);
    const dDel = await db.collection("emails").findOne({
      _id: new (require("mongodb").ObjectId)(delTarget.id),
    });
    check("D.cancel reverted optimistic delete", dDel.isDeleted === false);
    check("D.cache busted after undo", (await keysForUser()).length === 0);

    // ══ SCENARIO E — poller lifecycle on synthetic user ═════════════════════
    console.log("\n[E] poller lifecycle (synthetic id)");
    await enqueuePeriodicSync(uidStr);
    check("E.poller armed", await isPollerActive(uidStr) === true);
    await stopPeriodicSync(uidStr);
    check("E.poller stopped", await isPollerActive(uidStr) === false);

    // ══ SCENARIO F — response contract shapes (I1) ══════════════════════════
    console.log("\n[F] API contract shapes");
    const cur = await call(getEmails, uidStr, { query: { folder: "inbox", limit: "5" } });
    check("F.cursor payload keys exact", (() => {
      const k = Object.keys(cur.body.pagination || {}).sort();
      return JSON.stringify(k) === JSON.stringify(["hasMore", "nextCursor", "total"]);
    })());
    const leg = await call(getEmails, uidStr, { query: { folder: "inbox", offset: "0", limit: "5" } });
    check("F.legacy payload keeps source+totalCount",
      typeof leg.body.source === "string" && typeof leg.body.totalCount === "number" &&
      Array.isArray(leg.body.emails));
    const badCur = await call(getEmails, uidStr, { query: { folder: "inbox", cursor: "@@bad@@" } });
    check("F.invalid cursor rejected 400 {message}",
      badCur.status === 400 && typeof badCur.body.message === "string");

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    try {
      await stopPeriodicSync(uidStr).catch(() => {});
      await db.collection("emails").deleteMany({ userId: uid });
      await db.collection("users").deleteMany({ googleId: G });
      await db.collection("categorypreferences").deleteMany({ senderDomain: /test\.dev$/ });
      await scanAndDelete(redisClient, `user:${uidStr}:*`);
      console.log("🧹 Synthetic user, emails, cache keys removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    await redisClient.quit().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
