/**
 * Phase 9 — end-to-end AI fallback integration through the REAL sync pipeline.
 *
 * Stubs:
 *   - Gmail client (require-cache) — controlled incremental window
 *   - AIClassifierService singleton (require-cache) — fake provider
 *
 * Proves against REAL MongoDB:
 *   RUN 1 (AI enabled, valid output):
 *     - uncertain emails persist with source="ai" + provider category
 *   RUN 2 (AI enabled, provider always fails):
 *     - emails ingest with their DETERMINISTIC result preserved
 *     - run completes; cursor policy unaffected
 *
 * Synthetic data only; cleanup guaranteed in finally.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");

// ── Stub Gmail client BEFORE service load ───────────────────────────────────
const gmailClientPath = require.resolve("../src/utils/gmailClient");
require(gmailClientPath);
require.cache[gmailClientPath].exports = {
  getGmailClient: () => global.mockGmail,
};

// ── Injectable fake AI provider (replaces the production singleton) ─────────
let aiBehavior = () => '{"category":"jobs","confidence":0.77}';
let aiCallCount = 0;
const aiClassifierPath = require.resolve("../src/services/ai/aiClassifier");
require(aiClassifierPath);
const realAIModule = require.cache[aiClassifierPath].exports;
require.cache[aiClassifierPath].exports = {
  ...realAIModule,
  aiClassifier: {
    enabled: () => true,
    getStats: () => ({ calls: aiCallCount }),
    classifyUncertain: async ({ subject }) => {
      aiCallCount++;
      const raw = aiBehavior(subject);
      if (raw instanceof Error) throw raw;
      // Route through the REAL validator? The validator lives inside the
      // factory closure; instead mirror its contract here minimally and rely
      // on unit tests for strictness. Persisted value must be canonical.
      try {
        const obj = JSON.parse(raw);
        const CATEGORIES = ["uncategorized","jobs","social","finance","travel","food",
          "shopping","health","education","newsletters","personal","promotions","updates"];
        if (!CATEGORIES.includes(obj.category)) return null;
        return { category: obj.category, source: "ai",
          confidence: Math.min(1, Math.max(0, Number(obj.confidence) || 0.6)),
          uncertain: false,
          signals: [{ type: "ai", value: "provider", weight: 0.7 }] };
      } catch { return null; }
    },
  },
};

const User = require("../src/models/User");
const { runSync } = require("../src/services/emailSyncService");

const G = `phase9-ai-${Date.now()}`;
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const { insertedId: uid } = await db.collection("users").insertOne({
    googleId: G, email: `${G}@synthetic.invalid`, name: "phase9 ai e2e",
    accessToken: "s", refreshToken: "s", tokenExpiry: new Date(Date.now() + 36e5),
    lastHistoryId: "100",
    syncState: { nextPageToken: null, totalSynced: 0, isSyncing: true,
      syncStartedAt: new Date(), activeJobId: "job1", idlePolls: 0, erroredRuns: 0 },
  });
  const uidStr = uid.toString();

  global.mockGmail = {
    users: {
      getProfile: async () => ({ data: { historyId: "2000" } }),
      history: { list: async () => ({ data: { history: [
        { messagesAdded: [{ message: { id: `${G}-u1` } }] },
        { messagesAdded: [{ message: { id: `${G}-u2` } }] },
      ] } }) },
      messages: {
        get: async ({ id }) => ({
          data: {
            id, threadId: id, labelIds: ["INBOX"],
            snippet: "opaque snippet", internalDate: String(Date.now()),
            payload: { headers: [
              { name: "From", value: "someone@unknown-domain.example" },
              { name: "To", value: "me@test.dev" },
              { name: "Subject", value: `totally ambiguous ${id.slice(-4)}` },
            ] },
          },
        }),
      },
    },
  };

  const freshLocked = () => User.findOneAndUpdate(
    { _id: uid },
    { $set: { "syncState.isSyncing": true, "syncState.activeJobId": "job1" } },
    { returnDocument: "after" }
  );

  try {
    // ── RUN 1: valid AI output ────────────────────────────────────────────
    aiBehavior = () => '{"category":"jobs","confidence":0.77}';
    let user = await freshLocked();
    const r1 = await runSync({ user, syncType: "incremental", jobId: "job1" });

    check("run1 ingested both messages", r1.saved === 2 && r1.errors === 0);
    check("run1 AI called once per uncertain message", aiCallCount === 2);

    const d1 = await db.collection("emails").findOne({ gmailMessageId: `${G}-u1` });
    const d2 = await db.collection("emails").findOne({ gmailMessageId: `${G}-u2` });
    check("doc1: category from AI + source='ai'",
      d1.category === "jobs" && d1.classificationSource === "ai");
    check("doc2: same treatment", d2.category === "jobs" && d2.classificationSource === "ai");

    const persisted = await db.collection("users").findOne({ _id: uid });
    check("cursor advanced past clean run (=2000)", persisted.lastHistoryId === "2000");

    // ── RUN 2: new uncertain mail, AI provider failing every call ─────────
    await db.collection("users").updateOne(
      { _id: uid }, { $set: { lastHistoryId: "2000" } }
    );
    // second history window with two more uncertain messages
    global.mockGmail.users.history.list = async () => ({ data: { history: [
      { messagesAdded: [{ message: { id: `${G}-u3` } }] },
      { messagesAdded: [{ message: { id: `${G}-u4` } }] },
    ] } });
    global.mockGmail.users.messages.get = async ({ id }) => ({
      data: {
        id, threadId: id, labelIds: ["INBOX"], snippet: "", internalDate: String(Date.now()),
        payload: { headers: [
          { name: "From", value: "other@unknown2.example" },
          { name: "To", value: "" },
          { name: "Subject", value: `ambiguous again ${id.slice(-4)}` },
        ] },
      },
    });

    aiBehavior = () => { throw new Error("provider outage"); };
    user = await freshLocked();
    const r2 = await runSync({ user, syncType: "incremental", jobId: "job1" });

    check("run2 ingested despite AI outage", r2.saved === 2 && r2.errors === 0);
    const d3 = await db.collection("emails").findOne({ gmailMessageId: `${G}-u3` });
    const d4 = await db.collection("emails").findOne({ gmailMessageId: `${G}-u4` });
    check("deterministic results preserved (default source, uncategorized)",
      d3.category === "uncategorized" && d3.classificationSource === "default" &&
      d4.category === "uncategorized" && d4.classificationSource === "default");
    const afterR2 = await db.collection("users").findOne({ _id: uid });
    check("cursor at mailbox head + zero error streak after clean AI-failure run",
      afterR2.lastHistoryId === "2000" && afterR2.syncState?.erroredRuns === 0);

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    delete global.mockGmail;
    require.cache[aiClassifierPath].exports = realAIModule;
    try {
      await db.collection("emails").deleteMany({ userId: uid });
      await db.collection("users").deleteOne({ _id: uid });
      console.log("🧹 Synthetic state removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
