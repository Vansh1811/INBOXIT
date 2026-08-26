/**
 * Phase 10 — feedback & personalization end-to-end verification.
 *
 * Uses REAL production functions against live MongoDB + Redis:
 *   - controllers/emailController.js handlers (updateEmail / archiveEmail)
 *     with the BullMQ queue boundary stubbed (jobs captured, never delivered)
 *   - services/emailSyncService.loadUserPreferences (active-only loader)
 *   - services/classifier.classifyDetailed (production classifier)
 *   - models/CategoryPreference.recordFeedback via the controller path
 *
 * Covers: auto-classification → manual correction → evidence → activation →
 * preference-beats-rule → reversal → isolation → idempotency →
 * feedback-persistence-failure isolation.
 *
 * Synthetic user only; guaranteed try/finally cleanup.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const crypto = require("crypto");

// Stub the queue boundary BEFORE the controller loads.
const capturedJobs = [];
let fakeRemoved = 0;
const jobsById = {};
const actionQueuePath = require.resolve("../src/queues/actionQueue");
require(actionQueuePath);
require.cache[actionQueuePath].exports = {
  actionQueue: {
    getJob: async (jobId) => ({
      id: jobId,
      getState: async () => "delayed",
      remove: async () => { fakeRemoved++; },
      data: jobsById[jobId] || {},
    }),
  },
  enqueueActionJob: async (userId, emailKey, gmailIds, action, snapshot) => {
    const jobId = `action:${userId}:${emailKey}`;
    jobsById[jobId] = { userId, emailId: emailKey, action, ...(snapshot || {}) };
    capturedJobs.push({ jobId, action, snapshot });
    return jobId;
  },
};

const Email = require("../src/models/Email");
const CategoryPreference = require("../src/models/CategoryPreference");
const { updateEmail } = require("../src/controllers/emailController");
const { loadUserPreferences } = require("../src/services/emailSyncService");
const { classifyDetailed } = require("../src/services/classifier");
const { activeCategoryOf } = require("../src/services/preferencePolicy");
const { scanAndDelete } = require("../src/utils/cacheBust");
const { redisClient } = require("../src/config/redis");

const MARKER = `phase10-fb-${Date.now()}`;
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function makeReq(userId, params, body, warnCapture) {
  return {
    id: crypto.randomUUID(),
    user: { id: userId },
    query: {}, params, body,
    log: {
      info() {}, error() {},
      warn(...a) { warnCapture.push(a); },
    },
  };
}
async function callUpdate(userId, emailId, body, warnCapture = []) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await updateEmail(makeReq(userId, { id: emailId }, body, warnCapture), res, () => {});
  return { status: res.statusCode, body: res.body };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // Two isolated synthetic users
  const mkUser = (tag) => db.collection("users").insertOne({
    googleId: `${MARKER}-${tag}`,
    email: `${MARKER}-${tag}@synthetic.invalid`,
    name: `phase10 ${tag}`,
    accessToken: "s", refreshToken: "s",
    tokenExpiry: new Date(Date.now() + 36e5),
  });
  const u1res = await mkUser("u1");
  const u2res = await mkUser("u2");
  const U1 = u1res.insertedId.toString();
  const U2 = u2res.insertedId.toString();

  let n = 0;
  async function seedAmazon(forUid, originalCategory = "uncategorized") {
    n++;
    const gm = `${MARKER}-amz-${n}`;
    await db.collection("emails").deleteMany({ gmailMessageId: gm });
    const doc = {
      userId: new (require("mongodb").ObjectId)(forUid),
      gmailMessageId: gm,
      from: `Amazon Shipping <shipment@amazon.com>`, // matches shopping.from rule
      to: "me@test.dev",
      subject: `${MARKER} shipment #${n}`,
      snippet: `your package ${n}`,
      receivedAt: new Date(Date.now() + n * 60000),
      category: originalCategory,
      classificationSource: "rule",
      userOverride: false,
      isRead: true, isStarred: false, isDeleted: false,
      labels: ["INBOX"],
    };
    const { insertedId } = await db.collection("emails").insertOne(doc);
    return { id: insertedId.toString(), gm, subject: doc.subject };
  }

  const activeMapFor = async (uidStr) => loadUserPreferences(new (require("mongodb").ObjectId)(uidStr));
  const cleanupIds = [];
  let warns = [];

  try {
    // ── Step 1: automatic classification of a fresh Amazon mail ────────────
    console.log("\n[1] automatic classification (deterministic baseline)");
    const e1 = await seedAmazon(U1);
    cleanupIds.push(e1.id);
    const auto = classifyDetailed(
      "Amazon Shipping <shipment@amazon.com>", e1.subject,
      await activeMapFor(U1), ["INBOX"]
    );
    check("rules classify fresh mail as shopping", auto.category === "shopping" && auto.source === "rule");
    check("no preference exists yet for the domain", Object.keys(await activeMapFor(U1)).length === 0);

    // ── Step 2: manual correction #1 → recorded, NOT yet overriding ────────
    console.log("\n[2] first manual correction (finance)");
    warns = [];
    let r1up = await callUpdate(U1, e1.id, { category: "finance" }, warns);
    check("update accepted", r1up.status === 200 && r1up.body.category === "finance");
    check("classificationSource=user on response", r1up.body.classificationSource === "user");
    const prefDoc1 = await CategoryPreference.findOne({ userId: u1res.insertedId, senderDomain: "amazon.com" });
    check("feedback recorded with evidence=1", prefDoc1?.total === 1);
    check("NOT yet an active override (one correction ≠ rule)",
      activeCategoryOf({ tallies: prefDoc1.tallies, total: prefDoc1.total }) === null);

    // Future same-domain email still follows the RULE while weak
    const e2 = await seedAmazon(U1);
    cleanupIds.push(e2.id);
    const stillRule = classifyDetailed(
      "Amazon Shipping <shipment@amazon.com>", e2.subject,
      await activeMapFor(U1), ["INBOX"]
    );
    check("weak feedback does not override rules yet", stillRule.category === "shopping");

    // ── Step 3: second consistent correction → ACTIVATED ────────────────────
    console.log("\n[3] second consistent correction → activation");
    warns = [];
    r1up = await callUpdate(U1, e2.id, { category: "finance" }, warns);
    check("second update accepted", r1up.status === 200);
    const prefAfter2 = await CategoryPreference.findOne({ userId: u1res.insertedId, senderDomain: "amazon.com" });
    const activatedNow =
      activeCategoryOf({ tallies: prefAfter2.tallies, total: prefAfter2.total }) === "finance";
    check("preference now ACTIVE for amazon.com→finance", activatedNow);

    // ── Step 4: preference beats the generic rule ───────────────────────────
    console.log("\n[4] learned preference overrides the shopping rule");
    const e3 = await seedAmazon(U1);
    cleanupIds.push(e3.id);
    const prefBeat = classifyDetailed(
      "Amazon Shipping <shipment@amazon.com>", e3.subject,
      await activeMapFor(U1), ["INBOX"]
    );
    check("fresh same-domain mail classifies as finance via preference",
      prefBeat.category === "finance" &&
      prefBeat.source === "preference" &&
      prefBeat.signals.some((s) => s.type === "user_preference" && s.value === "amazon.com"));
    check("certain ⇒ AI would not be invoked at this boundary",
      prefBeat.uncertain === false);

    // ── Step 5: idempotent re-affirmation does not inflate evidence ─────────
    console.log("\n[5] idempotent manual update");
    const beforeTotal = prefAfter2.total;
    r1up = await callUpdate(U1, e2.id, { category: "finance" }, warns);
    check("re-affirmation accepted", r1up.status === 200);
    const afterReaffirm = await CategoryPreference.findOne({
      userId: u1res.insertedId, senderDomain: "amazon.com",
    });
    check("evidence NOT inflated by identical request",
      afterReaffirm.total === beforeTotal);

    // ── Step 6: reversal — user changes their mind toward shopping ──────────
    console.log("\n[6] reversal via newer contrary corrections");
    const rev1 = await seedAmazon(U1);
    const rev2 = await seedAmazon(U1);
    cleanupIds.push(rev1.id, rev2.id);
    await callUpdate(U1, rev1.id, { category: "shopping" });
    await callUpdate(U1, rev2.id, { category: "shopping" });
    const mapAfterReversal = await activeMapFor(U1);
    check("active preference reversed to shopping",
      mapAfterReversal["amazon.com"] === "shopping",
      JSON.stringify(mapAfterReversal));

    // ── Step 7: cross-user isolation ─────────────────────────────────────────
    console.log("\n[7] per-user isolation");
    const eU2 = await seedAmazon(U2);
    const eU2b = await seedAmazon(U2);
    cleanupIds.push(eU2.id, eU2b.id);
    // Two DISTINCT emails corrected to health → evidence reaches activation.
    await callUpdate(U2, eU2.id, { category: "health" });
    await callUpdate(U2, eU2b.id, { category: "health" });
    const mapU1 = await activeMapFor(U1);
    const mapU2 = await activeMapFor(U2);
    check("user2's health preference exists independently",
      mapU2["amazon.com"] === "health");
    check("user1 unaffected by user2 (still shopping)",
      mapU1["amazon.com"] === "shopping");

    // ── Step 8: feedback persistence failure does NOT undo the update ──────
    console.log("\n[8] feedback write failure isolated");
    const failTarget = await seedAmazon(U1);
    cleanupIds.push(failTarget.id);
    warns = [];
    const origRecord = CategoryPreference.recordFeedback;
    CategoryPreference.recordFeedback = async () => { throw new Error("simulated pref write failure"); };
    let rFail;
    try {
      rFail = await callUpdate(U1, failTarget.id, { category: "travel" }, warns);
    } finally {
      CategoryPreference.recordFeedback = origRecord;
    }
    check("category update still succeeds when feedback write fails",
      rFail.status === 200 && rFail.body.category === "travel");
    check("failure surfaced through structured warning", warns.length >= 1);
    const dFail = await db.collection("emails").findOne({ _id: new (require("mongodb").ObjectId)(failTarget.id) });
    check("email mutation persisted", dFail.category === "travel" && dFail.userOverride === true);

    // ── Step 9: classifier backwards compatibility (no prefs at all) ────────
    console.log("\n[9] no-preference backward compatibility");
    const noPrefs = classifyDetailed(
      "Naukri <alerts@naukri.com>", "new job alert", {}, []
    );
    check("classifier behaves identically without preferences", noPrefs.category === "jobs");

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    try {
      const oid = require("mongodb").ObjectId;
      const ids = cleanupIds.filter(Boolean).map((id) => new oid(id));
      if (ids.length) await db.collection("emails").deleteMany({ _id: { $in: ids } });
      await db.collection("emails").deleteMany({ subject: { $regex: `^${MARKER}` } });
      // Remove ONLY the synthetic users…
      await db.collection("users").deleteMany({ googleId: { $regex: `^${MARKER}` } });
      // …and their preferences, scoped strictly to those ObjectId user ids.
      await db.collection("categorypreferences").deleteMany({
        userId: { $in: [u1res.insertedId, u2res.insertedId] },
      });
      // Cache invalidation scoped strictly to the two synthetic users.
      await scanAndDelete(redisClient, `user:${U1}:*`);
      await scanAndDelete(redisClient, `user:${U2}:*`);
      console.log("🧹 Synthetic state removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    await redisClient.quit().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
