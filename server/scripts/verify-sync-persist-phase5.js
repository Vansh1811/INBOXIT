/**
 * Phase 5 verification — sync cursor persistence + O-H1 retention policy.
 *
 * Uses a SYNTHETIC user/emails in MongoDB and a STUBBED Gmail client
 * (no real Gmail calls). Verifies against the REAL database that:
 *
 *   REGRESSION FIX: run results (lastHistoryId / nextPageToken / erroredRuns)
 *     are actually PERSISTED via the ownership-guarded update.
 *   O-H1: an incremental run with fetch errors RETAINS the previous
 *     lastHistoryId; a clean run advances it; the poison-window cap advances
 *     and flags partial.
 *
 * All state is cleaned up in finally.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");

// ── Stub the Gmail client BEFORE requiring the service ──────────────────────
const gmailClientPath = require.resolve("../src/utils/gmailClient");
require(gmailClientPath);
require.cache[gmailClientPath].exports = {
  getGmailClient: () => global.mockGmail,
};

const User = require("../src/models/User");
const { runSync } = require("../src/services/emailSyncService");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const G = `phase5-persist-${Date.now()}`;

  // Synthetic user holding the lock exactly as the real worker would
  const { insertedId: userId } = await db.collection("users").insertOne({
    googleId: G,
    email: `${G}@synthetic.invalid`,
    name: "phase5 persist test",
    accessToken: "synthetic",
    refreshToken: "synthetic",
    tokenExpiry: new Date(Date.now() + 3600e3),
    lastHistoryId: "1000",
    syncState: {
      nextPageToken: null,
      totalSynced: 0,
      isSyncing: true,          // lock held by "verify-job"
      syncStartedAt: new Date(),
      activeJobId: "verify-job",
      idlePolls: 0,
      erroredRuns: 0,
    },
  });
  const uidStr = userId.toString();

  await db.collection("emails").insertMany([
    { userId, gmailMessageId: `${G}-ok`, subject: "ok", snippet: "", from: "a@t.dev", receivedAt: new Date(), category: "uncategorized", isRead: true, isStarred: false, isDeleted: false, labels: ["INBOX"] },
    { userId, gmailMessageId: `${G}-bad`, subject: "bad", snippet: "", from: "b@t.dev", receivedAt: new Date(), category: "uncategorized", isRead: true, isStarred: false, isDeleted: false, labels: ["INBOX"] },
  ]);

  // Mock Gmail surface
  let failOnGet = null; // message id to fail with a transient 500
  global.mockGmail = {
    users: {
      getProfile: async () => ({ data: { historyId: "9000" } }),
      history: {
        list: async () => ({
          data: {
            history: [
              { messagesAdded: [{ message: { id: `${G}-ok` } }] },
              { messagesAdded: [{ message: { id: `${G}-bad` } }] },
            ],
          },
        }),
      },
      messages: {
        get: async ({ id }) => {
          if (id === failOnGet) {
            const e = new Error("Backend Error");
            e.response = { status: 500, data: { error: { message: "Backend Error" } } };
            throw e;
          }
          return {
            data: {
              id,
              threadId: id,
              labelIds: ["INBOX"],
              snippet: "s",
              internalDate: String(Date.now()),
              payload: { headers: [
                { name: "From", value: "x@t.dev" },
                { name: "To", value: "y@t.dev" },
                { name: "Subject", value: id },
              ] },
            },
          };
        },
      },
    },
  };

  const freshUser = async () =>
    User.findOneAndUpdate(
      { _id: userId },
      { $set: { "syncState.isSyncing": true, "syncState.activeJobId": "verify-job" } },
      { new: true }
    );

  try {
    // ── RUN 1: transient failure on one message ────────────────────────────
    failOnGet = `${G}-bad`;
    let user = await freshUser();
    const res1 = await runSync({
      user, syncType: "incremental", jobId: "verify-job",
    });

    check("run1 reports errors=1 & partial=true", res1.errors === 1 && res1.partial === true);
    check("run1 does NOT advance cursor (poisonWindow=false)",
      res1.poisonWindow === false);

    let persisted = await db.collection("users").findOne({ _id: userId });
    check("REGRESSION FIX: lastHistoryId RETAINED in DB (=1000)",
      persisted.lastHistoryId === "1000", `got ${persisted.lastHistoryId}`);
    check("erroredRuns persisted as 1", persisted.syncState?.erroredRuns === 1);

    // The successful message of the batch was still ingested
    const okDoc = await db.collection("emails").findOne({ gmailMessageId: `${G}-ok` });
    check("successful message ingested despite sibling failure", Boolean(okDoc));

    // ── RUN 2: clean run advances cursor and resets streak ─────────────────
    failOnGet = null;
    user = await freshUser();
    const res2 = await runSync({ user, syncType: "incremental", jobId: "verify-job" });
    check("run2 clean (errors=0)", res2.errors === 0);

    persisted = await db.collection("users").findOne({ _id: userId });
    check("REGRESSION FIX: lastHistoryId ADVANCED in DB (=9000)",
      persisted.lastHistoryId === "9000", `got ${persisted.lastHistoryId}`);
    check("erroredRuns reset to 0 on clean run", persisted.syncState?.erroredRuns === 0);

    // ── RUN 3: poison window — repeated failures eventually give up ────────
    failOnGet = `${G}-bad`;
    // simulate two prior consecutive errored runs
    await db.collection("users").updateOne(
      { _id: userId }, { $set: { "syncState.erroredRuns": 2 } }
    );
    user = await freshUser();
    const res3 = await runSync({ user, syncType: "incremental", jobId: "verify-job" });
    check("run3 hit poison cap (poisonWindow=true)", res3.poisonWindow === true);

    persisted = await db.collection("users").findOne({ _id: userId });
    check("poison cap forces cursor advance in DB (=9000)",
      persisted.lastHistoryId === "9000");
    check("streak reset after giving up", persisted.syncState?.erroredRuns === 0);

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    try {
      await db.collection("users").deleteMany({ googleId: G });
      await db.collection("emails").deleteMany({ gmailMessageId: { $regex: `^${G}` } });
      await db.collection("categorypreferences").deleteMany({});
      console.log("🧹 Synthetic state removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    delete global.mockGmail;
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
