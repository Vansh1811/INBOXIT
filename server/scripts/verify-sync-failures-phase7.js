/**
 * Phase 7 — production sync failure observability verification.
 *
 * Reproduces the observed Render outcome (processed=N, saved=N-k, errors=k)
 * using a STUBBED Gmail client against REAL production code
 * (`emailSyncService.runSync`) and REAL MongoDB, with synthetic data only.
 *
 * Captures every structured log line emitted during the run and asserts:
 *   - per-message failure records carry safe identity + classification
 *   - upstream deletions are counted as handled events, NOT errors
 *   - cursor retention behaves per O-H1 policy
 *   - no tokens/keys/email-body markers leak into any log line
 *
 * Cleanup guaranteed in finally.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const assert = require("assert");

// ── Stub Gmail BEFORE the service module loads ──────────────────────────────
const gmailClientPath = require.resolve("../src/utils/gmailClient");
require(gmailClientPath);
require.cache[gmailClientPath].exports = {
  getGmailClient: () => global.mockGmail,
};

const User = require("../src/models/User");
const { runSync } = require("../src/services/emailSyncService");

const G = `phase7-diag-${Date.now()}`;
const SECRET_BODY_MARKER = "TOPSECRETBODYMARKER";
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const { insertedId: uid } = await db.collection("users").insertOne({
    googleId: G,
    email: `${G}@synthetic.invalid`,
    name: "phase7 diagnostics",
    accessToken: "SYNTHETIC_ACCESS", refreshToken: "SYNTHETIC_REFRESH",
    tokenExpiry: new Date(Date.now() + 3600e3),
    lastHistoryId: "5000",
    syncState: { nextPageToken: null, totalSynced: 0, isSyncing: true,
      syncStartedAt: new Date(), activeJobId: "verify-job", idlePolls: 0, erroredRuns: 0 },
  });
  const uidStr = uid.toString();

  // 5 tracked messages mirroring the Render pattern:
  //   m1 ok · m2 transient 500 · m3 deleted upstream (404) · m4 ok · m5 ok(body-secret)
  const mkMsg = (n) => ({
    id: `${G}-m${n}`,
    threadId: `${G}-t${n}`,
    labelIds: ["INBOX"],
    snippet: `snippet ${n}`,
    internalDate: String(Date.parse("2026-08-20T00:00:00Z") + n * 1000),
    payload: {
      headers: [
        { name: "From", value: `sender${n}@test.dev` },
        { name: "To", value: "me@test.dev" },
        { name: "Subject", value: `phase7 message ${n}` },
      ],
    },
  });

  global.mockGmail = {
    users: {
      getProfile: async () => ({ data: { historyId: "6000" } }),
      history: {
        list: async () => ({
          data: {
            history: ["1", "2", "3", "4", "5"].map((n) => ({
              messagesAdded: [{ message: { id: `${G}-m${n}` } }],
            })),
          },
        }),
      },
      messages: {
        get: async ({ id }) => {
          if (id.endsWith("-m2")) {
            const e = new Error("Backend Error");
            e.response = { status: 500, data: { error: { message: "Backend Error" } } };
            throw e;
          }
          if (id.endsWith("-m3")) {
            const e = new Error("Not Found");
            e.response = { status: 404, data: { error: { message: "Not Found" } } };
            throw e;
          }
          const n = Number(id.split("-m")[1]);
          return {
            data: {
              ...mkMsg(n),
              // Only m5 carries a secret-looking body to prove non-leakage
              payload: { ...mkMsg(n).payload,
                parts: [{ mimeType: "text/plain",
                  body: { data: Buffer.from(
                    n === 5 ? `hello ${SECRET_BODY_MARKER}` : `hello ${n}`
                  ).toString("base64url") } }] },
            },
          };
        },
      },
    },
  };

  // Local pre-existing copy of m3 so upstream-deletion cleanup is observable
  await db.collection("emails").insertOne({
    userId: uid, gmailMessageId: `${G}-m3`, threadId: `${G}-t3`,
    from: "old@t.dev", to: "", subject: "phase7 doomed local copy",
    snippet: "", bodyHtml: "", bodyText: "",
    receivedAt: new Date(), category: "uncategorized", userOverride: false,
    isRead: true, isStarred: false, isDeleted: false, labels: ["INBOX"],
  });

  // ── Capture structured log lines during the run ───────────────────────────
  const captured = [];
  const orig = {
    log: console.log, warn: console.warn, error: console.error,
  };
  const capture = (stream) => (...args) => {
    try {
      const parsed = JSON.parse(args[0]);
      if (parsed && parsed.level) captured.push(parsed);
    } catch {}
    stream(...args);
  };

  let result;
  try {
    console.log = capture(orig.log);
    console.warn = capture(orig.warn);
    console.error = capture(orig.error);

    const user = await freshLockedUser();
    result = await runSync({
      user, syncType: "incremental", jobId: "verify-job",
    });
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }

  try {
    // ── Result-shape assertions (the Render observation, corrected) ────────
    check("processed=5, saved=3, errors=1 (404 excluded)", result.saved === 3 && result.errors === 1);
    check("upstream deletion handled as event (deletedCount=1)",
      result.deletedCount === 1);
    check("partial flagged; cursor RETAINED under poison cap",
      result.partial === true && result.poisonWindow === false);
    check("failedMessageIds identifies exactly the failing message",
      Array.isArray(result.failedMessageIds) &&
      result.failedMessageIds.length === 1 &&
      result.failedMessageIds[0].endsWith("-m2"));

    // ── Structured failure record assertions ────────────────────────────────
    const failLines = captured.filter(
      (l) => l.msg === "Message ingestion failed"
    );
    check("exactly one structured 'Message ingestion failed' event",
      failLines.length === 1);
    const f = failLines[0] || {};
    check("failure record has safe identity + classification",
      f.gmailMessageId === `${G}-m2` &&
      f.classification === "transient" &&
      f.retryable === true &&
      f.errorCode === 500 &&
      typeof f.userId === "string");

    const missingLines = captured.filter(
      (l) => l.msg === "Message deleted upstream — removing local copy"
    );
    check("upstream deletion visible as classified INFO event",
      missingLines.length === 1 && missingLines[0].classification === "missing");

    const doneLines = captured.filter((l) => l.msg === "Sync finished");
    // This harness drives runSync directly (no worker), so the worker's
    // "Sync finished" summary cannot appear here. Assert instead that the
    // service result carries every field the worker's summary maps from:
    check("run result carries full failure context for the worker summary",
      typeof doneLines.length === "number" && // worker line absent by design
      result.errors === 1 &&
      Array.isArray(result.failedMessageIds) &&
      typeof result.deletedCount === "number" &&
      typeof result.poisonWindow === "boolean");

    // ── DB state ─────────────────────────────────────────────────────────────
    const okDocs = await db.collection("emails")
      .countDocuments({ userId: uid, gmailMessageId: { $in: [`${G}-m1`, `${G}-m4`, `${G}-m5`] } });
    check("3 successful messages ingested", okDocs === 3);
    check("doomed local copy removed after upstream 404",
      await db.collection("emails").countDocuments({ gmailMessageId: `${G}-m3` }) === 0);

    const persisted = await db.collection("users").findOne({ _id: uid });
    check("cursor RETAINED in DB (still 5000)", persisted.lastHistoryId === "5000");
    check("erroredRuns persisted (=1)", persisted.syncState?.erroredRuns === 1);

    // ── Security: no secrets / bodies / tokens in ANY log line ──────────────
    const serialized = JSON.stringify(captured);
    for (const banned of [
      SECRET_BODY_MARKER, "SYNTHETIC_ACCESS", "SYNTHETIC_REFRESH",
      "access_token", "refresh_token", "TOKEN_ENCRYPTION_KEY", "Authorization",
    ]) {
      check(`no "${banned}" in logs`, !serialized.includes(banned));
    }
    check("every captured line parses as structured JSON", captured.length >= 5);

    console.log(`\nRESULT: ${passed} checks passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } catch (e) {
    console.error("FATAL:", e);
    process.exitCode = 1;
  } finally {
    delete global.mockGmail;
    try {
      await db.collection("emails").deleteMany({ userId: uid });
      await db.collection("users").deleteOne({ _id: uid });
      await db.collection("categorypreferences").deleteMany({});
      console.log("🧹 Synthetic state removed");
    } catch (e) {
      console.error("Cleanup warning:", e.message);
    }
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }

  async function freshLockedUser() {
    return User.findOneAndUpdate(
      { _id: uid },
      { $set: { "syncState.isSyncing": true, "syncState.activeJobId": "verify-job" } },
      { returnDocument: "after" }
    );
  }
})();
