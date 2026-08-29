const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classifyDetailed, fallbackClassification } = require("./classifier");
const {
  evaluateCategoryHistory,
  applyContext,
  combineEvaluations,
  CONTEXT_ELIGIBLE_MAX_CONFIDENCE,
} = require("./contextPolicy");
const { createBatchedContextLoader } = require("./contextResolver");
const { isValidCategory, extractSenderDomain } = require("./categories");
const { aiClassifier } = require("./ai/aiClassifier");
const {
  activeCategoryOf,
} = require("./preferencePolicy");
const { shouldAdvanceCursor } = require("../utils/syncPolicy");
const { isRevokedGmailError, classifyGmailError } = require("../utils/gmailErrors");
const Email = require("../models/Email");
const User = require("../models/User");
const CategoryPreference = require("../models/CategoryPreference");
const axios = require("axios");
const logger = require("../utils/logger").child({ component: "email-sync" });

const CHUNK_SIZE = 500;
const BATCH_SIZE = 10;

/** Load this user's learned sender→category preferences once per sync run. */
/**
 * Load ACTIVE per-user sender preferences once per sync run.
 *
 * Phase 10: only records whose evidence satisfies the policy
 * (services/preferencePolicy.js) are returned — weak/one-off corrections
 * never override deterministic rules. Bounded by the number of distinct
 * domains a user has actively corrected.
 */
const loadUserPreferences = async (userId) => {
  const prefs = await CategoryPreference.find({ userId })
    .select("senderDomain category tallies total")
    .lean();
  const map = {};
  for (const p of prefs) {
    const cat = activeCategoryOf({
      tallies: p.tallies || {},
      total: p.total || 0,
    });
    if (cat && isValidCategory(cat)) map[p.senderDomain] = cat;
  }
  return map;
};

/** AI budget per sync run — bounds cost even for huge uncertain batches. */
const MAX_AI_PER_RUN = 10;

/** Fresh, run-local AI accounting. No process-global counters live here. */
const createAiStats = () => ({
  eligible: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  budgetExhausted: 0,
  skippedDisabled: 0,
  skippedCircuitOpen: 0,
});

/** Keep the existing direct processEmail test seam working without a second
 * production counter set; canonical run stats use the names above. */
const incrementAiStat = (aiStats, field, legacyField = null) => {
  if (!aiStats) return;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(aiStats, key);
  const key = hasOwn(field) ? field : (legacyField && hasOwn(legacyField) ? legacyField : null);
  if (!key) return;
  aiStats[key] = (Number.isFinite(aiStats[key]) ? aiStats[key] : 0) + 1;
};

const processEmail = async (
  gmail,
  messageId,
  userId,
  userPrefs = {},
  existingDocsMap = new Map(),
  aiContext = null,
  contextLoader = null,
  aiStats = null
) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);

  const gmailLabels = msg.labelIds || [];

  const existingDoc = existingDocsMap.get(msg.id);
  const preserveCategory = !!existingDoc;

  // ── Classification (isolated from sync reliability — Phase 8) ────────────
  // A classifier failure must never drop the message or poison the sync run:
  // we ingest with an explicit low-confidence fallback and mark it uncertain
  // so the future AI fallback layer can revisit it.
  let decision;
  if (!preserveCategory) {
    try {
      decision = classifyDetailed(from, subject, userPrefs, gmailLabels);
      if (!decision || !isValidCategory(decision.category)) {
        throw new Error(`classifier returned invalid category: ${decision && decision.category}`);
      }
    } catch (err) {
      logger.warn(
        { userId, gmailMessageId: msg.id, err: err.message },
        "Classifier failed — using explicit fallback classification"
      );
      decision = fallbackClassification(err.message);
    }
  }

  // Never clobber a category the user set manually — user intent also means
  // spending AI budget here.

  // ── Phase 11: bounded contextual refinement ──────────────────────────────
  // Applies ONLY to weak/uncertain deterministic decisions (confidence at or
  // below the subject-only rule band). Strong evidence, active preferences
  // and manual overrides are never touched. Failures are contained: any
  // resolver/policy error keeps the deterministic decision intact.
  let contextMeta = null;
  if (
    contextLoader &&
    !preserveCategory &&
    decision?.confidence <= CONTEXT_ELIGIBLE_MAX_CONFIDENCE
  ) {
    try {
      const { domainEntries, threadEntries } = await contextLoader.resolve({
        senderDomain: extractSenderDomain(from),
        threadId: msg.threadId,
      });
      const combined = combineEvaluations(
        evaluateCategoryHistory(domainEntries || []),
        evaluateCategoryHistory(threadEntries || [])
      );
      if (combined.evaluation) {
        contextMeta = {
          type: combined.contextType,
          sample: combined.evaluation.sample,
          share: combined.evaluation.share,
        };
        decision = applyContext(decision, combined.evaluation, combined.contextType);
      } else {
        contextMeta = { applied: false };
      }
    } catch (err) {
      contextMeta = { error: err.message };
      logger.warn(
        { userId, gmailMessageId: msg.id, err: err.message },
        "Context refinement failed — deterministic result kept"
      );
    }
  }

  // ── Phase 9: AI fallback at the explicit uncertainty boundary ────────────
  // Runs AFTER contextual refinement so it receives the final post-context
  // uncertainty decision. Only genuinely uncertain results reach it.
  if (!preserveCategory && decision?.uncertain) {
    incrementAiStat(aiStats, "eligible", "candidates");

    try {
      if (!aiClassifier.enabled()) {
        incrementAiStat(aiStats, "skipped");
        incrementAiStat(aiStats, "skippedDisabled");
      } else if (!aiContext || aiContext.remaining <= 0) {
        incrementAiStat(aiStats, "skipped");
        incrementAiStat(aiStats, "budgetExhausted", "skippedBudget");
      } else {
        aiContext.remaining -= 1;
        try {
          const aiDecision = await aiClassifier.classifyUncertain({
            fromDomain: extractSenderDomain(from),
            subject,
            snippet: msg.snippet || "",
          });

          if (aiDecision && aiDecision.skipped) {
            incrementAiStat(aiStats, "skipped");
            if (aiDecision.reason === "circuit_open") {
              incrementAiStat(aiStats, "skippedCircuitOpen", "skippedCircuit");
            } else if (aiDecision.reason === "disabled") {
              incrementAiStat(aiStats, "skippedDisabled");
            }
          } else {
            incrementAiStat(aiStats, "attempted");
            if (aiDecision) {
              decision = aiDecision; // validated AI result replaces the weak one
              incrementAiStat(aiStats, "succeeded");
            } else {
              // null or unexpected result (timeout, malformed, provider error)
              incrementAiStat(aiStats, "failed", "fallbackKept");
            }
          }
        } catch (err) {
          // Absolute isolation: an unexpected AI-layer exception can never turn a
          // successfully fetched email into an ingestion failure.
          incrementAiStat(aiStats, "attempted");
          incrementAiStat(aiStats, "failed", "fallbackKept");
          logger.warn(
            { userId, gmailMessageId: msg.id, err: err?.message || String(err) },
            "AI fallback crashed — keeping deterministic classification"
          );
        }
      }
    } catch (err) {
      // Feature-flag failures are contained just like provider failures.
      incrementAiStat(aiStats, "failed", "fallbackKept");
      logger.warn(
        { userId, gmailMessageId: msg.id, err: err?.message || String(err) },
        "AI availability check failed — keeping deterministic classification"
      );
    }
  }

  return {
    userId,
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    senderDomain: extractSenderDomain(from),
    from,
    to,
    subject,
    snippet: msg.snippet,
    bodyHtml,
    bodyText,
    receivedAt: new Date(parseInt(msg.internalDate)),
    ...(preserveCategory
      ? {}
      : { category: decision.category, classificationSource: decision.source }),
    isRead:    !gmailLabels.includes("UNREAD"),
    isStarred:  gmailLabels.includes("STARRED") || false,
    isDeleted:  gmailLabels.includes("TRASH"),
    labels:     gmailLabels,
    ...(contextMeta && !preserveCategory ? { contextMeta } : {}),
  };
};

const fetchMessageChunk = async (gmail, pageToken = null, limit = CHUNK_SIZE) => {
  const allMessages = [];
  let currentPageToken = pageToken;

  while (allMessages.length < limit) {
    const batchSize = Math.min(100, limit - allMessages.length);

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: batchSize,
      labelIds: ["INBOX"],
      ...(currentPageToken && { pageToken: currentPageToken }),
    });

    const messages = res.data.messages || [];
    allMessages.push(...messages);
    currentPageToken = res.data.nextPageToken;

    if (!currentPageToken || messages.length === 0) break;
  }

  return {
    messages: allMessages,
    nextPageToken: currentPageToken || null,
  };
};

const fetchIncrementalMessageIds = async (gmail, startHistoryId) => {
  const changedIds = new Set();
  let pageToken;
  let historyId = startHistoryId;

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved", "messageDeleted"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    if (res.data.historyId && !pageToken) {
      historyId = res.data.historyId;
    }

    for (const record of res.data.history || []) {
      (record.messagesAdded || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsAdded   || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsRemoved || []).forEach((m) => changedIds.add(m.message.id));
      (record.messagesDeleted || []).forEach((m) => changedIds.add(m.message.id));
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return {
    messages: [...changedIds].map((id) => ({ id })),
    historyId
  };
};

const getExistingMessageIds = async (userId, gmailIds) => {
  const existing = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds } },
    { gmailMessageId: 1 }
  ).lean();
  return new Set(existing.map((e) => e.gmailMessageId));
};

/** Existing emails map for incremental sync preservation. */
const getExistingMessagesMap = async (userId, gmailIds) => {
  if (!gmailIds.length) return new Map();
  const docs = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds } },
    { gmailMessageId: 1 }
  ).lean();
  const map = new Map();
  for (const d of docs) map.set(d.gmailMessageId, d);
  return map;
};

const refreshTokenIfNeeded = async (user) => {
  const tokenExpiry = new Date(user.tokenExpiry).getTime();
  const buffer = 2 * 60 * 1000;

  if (tokenExpiry > Date.now() + buffer) return;

  logger.info(`[EmailSyncService] ⚠️  Token expiring — refreshing...`);
  try {
    const { data } = await axios.post("https://oauth2.googleapis.com/token", {
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: user.refreshToken,
      grant_type:    "refresh_token",
    });

    user.accessToken = data.access_token;
    user.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
    await user.save();
    logger.info(`[EmailSyncService] ✅ Token refreshed`);
  } catch (err) {
    // O-H3: only GENUINE revocation may be classified as a token error.
    // Transient Google/network failures (and Mongo write conflicts) must
    // keep normal retry semantics — the poller stays armed.
    if (!isRevokedGmailError(err)) throw err;

    const customError = new Error(
      "Gmail credentials were revoked. User needs to re-login."
    );
    customError.originalError = err;
    customError.isTokenError = true;
    throw customError;
  }
};

const getCurrentHistoryId = async (gmail) => {
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.historyId;
};

/**
 * Persist run results computed on the in-memory user document.
 *
 * Ownership-guarded: only the job that currently holds this user's sync lock
 * may write. Without this, cursor/resume/metric mutations would never reach
 * MongoDB (the worker's release update deliberately touches only lock and
 * freshness fields).
 *
 * Callers without a jobId (debug scripts) keep their in-memory-only behavior.
 */
async function persistRunResults(userId, jobId, fields) {
  if (!jobId) return;
  await User.updateOne(
    { _id: userId, "syncState.activeJobId": jobId },
    { $set: fields }
  );
}

/**
 * Public API
 */
async function runSync({ user, syncType, jobId, onProgress }) {
  const userId = user._id;
  // Run-scoped correlation: every per-message event carries this userId
  const runLog = logger.child({ userId: String(userId) });

  try {
    await refreshTokenIfNeeded(user);
  } catch (err) {
    // O-H3: only genuine revocation is flagged as a token error (which stops
    // live tracking). Transient/network failures propagate untouched so the
    // job retries normally and the poller stays armed.
    if (!err.isTokenError && !isRevokedGmailError(err)) throw err;

    const customError = err.isTokenError
      ? err
      : new Error("Gmail credentials were revoked. User needs to re-login.");
    if (!err.isTokenError) {
      customError.originalError = err;
      customError.isTokenError = true;
    }
    throw customError;
  }

  const gmail = getGmailClient(user);

  let messages = [];
  let nextPageToken = user.syncState?.nextPageToken || null;
  let didFallback = false;
  let incrementalHistoryId = null;

  const hasPendingPages = !!user.syncState?.nextPageToken;

  if (syncType === "incremental" && user.lastHistoryId) {
    logger.info(`[EmailSyncService] Incremental sync (historyId=${user.lastHistoryId})...`);
    let incrementalMessages = [];

    try {
      const incResult = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
      incrementalMessages = incResult.messages;
      incrementalHistoryId = incResult.historyId;
      logger.info(`[EmailSyncService] Incremental returned ${incrementalMessages.length} message(s)`);
    } catch (incErr) {
      const errMsg = incErr.response?.data?.error?.message || incErr.message;
      logger.info(`[EmailSyncService] ⚠️  Incremental failed (${errMsg}) — falling back to chunk`);
      didFallback = true;
    }

    if (!didFallback) {
      messages = incrementalMessages;
    } else {
      logger.info(`[EmailSyncService] Fallback chunk (resumeToken=${nextPageToken ? "saved" : "fresh"})...`);
      const result = await fetchMessageChunk(gmail, nextPageToken);
      messages = result.messages;
      nextPageToken = result.nextPageToken;
    }
  } else {
    logger.info(`[EmailSyncService] Chunk sync (token=${nextPageToken ? "resume" : "fresh"})...`);
    const result = await fetchMessageChunk(gmail, nextPageToken);
    messages = result.messages;
    nextPageToken = result.nextPageToken;
  }

  logger.info(`[EmailSyncService] ${messages.length} messages to process`);
  const aiStats = createAiStats();

  if (messages.length === 0) {
    logger.info(`[EmailSyncService] ✅ Nothing to sync`);
    if (syncType === "incremental" && !didFallback && incrementalHistoryId) {
      user.lastHistoryId = incrementalHistoryId;
    } else if (!hasPendingPages) {
      user.lastHistoryId = await getCurrentHistoryId(gmail);
    }
    user.syncState.erroredRuns = 0; // an empty poll is a successful poll
    await persistRunResults(userId, jobId, {
      lastHistoryId: user.lastHistoryId,
      "syncState.erroredRuns": 0,
    });
    return {
      isEmpty: true,
      hasMore: !!nextPageToken,
      hasPendingPages,
      aiStats,
      totalSynced: user.syncState.totalSynced || 0
    };
  }

  const allGmailIds = messages.map((m) => m.id);
  const isFull = syncType !== "incremental" || didFallback || hasPendingPages;
  const existingIds = isFull ? await getExistingMessageIds(userId, allGmailIds) : new Set();

  const newMessages = messages.filter((m) => !existingIds.has(m.id));
  const skipped = messages.length - newMessages.length;
  const total = newMessages.length;

  logger.info(`[EmailSyncService] Skipping ${skipped} already-synced, processing ${total} new`);

  // Learned preferences + user-protected categories are loaded ONCE per run
  const [userPrefs, existingDocsMap] = await Promise.all([
    loadUserPreferences(userId),
    getExistingMessagesMap(userId, allGmailIds),
  ]);

  // Phase 9: per-run AI budget shared across every message in this run
  const aiContext = { remaining: MAX_AI_PER_RUN };

  // Phase 11: memoizing context loader — one query per unique domain/thread
  // for the entire batch (N+1 prevention), with aggregate run-level stats.
  const contextLoader = createBatchedContextLoader(String(userId));
  const contextStats = { applied: 0, insufficient: 0, errors: 0 };

  let saved = 0;
  let errors = 0;
  const deletedIds = [];
  // O-B1: structured per-failure identity so `errors=N` is diagnosable
  // without exposing message content. Capped to bound log cardinality.
  const failedMessageIds = [];

  for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
    const batch = newMessages.slice(i, i + BATCH_SIZE);

    const parsedEmails = await Promise.all(
      batch.map(async ({ id }) => {
        try {
          return await processEmail(
            gmail, id, userId, userPrefs, existingDocsMap, aiContext, contextLoader, aiStats
          );
        } catch (err) {
          const classification = classifyGmailError(err);

          if (classification === "missing") {
            // 404/410: the message was deleted upstream. This is a HANDLED
            // event, not an ingestion error — it must not trigger cursor
            // retention or count against `errors`.
            deletedIds.push(id);
            runLog.info(
              { gmailMessageId: id, classification },
              "Message deleted upstream — removing local copy"
            );
            return null;
          }

          errors++;
          if (failedMessageIds.length < 50) failedMessageIds.push(id);

          runLog.error(
            {
              gmailMessageId: id,
              errorCode: err?.response?.status ?? null,
              classification,
              retryable: classification === "transient" || classification === "rate_limited",
              err: err?.response?.data?.error?.message || err.message,
            },
            "Message ingestion failed"
          );
          return null; // Partial failure — cursor policy decides retry
        }
      })
    );

    const validEmails = parsedEmails.filter((e) => e !== null);

    if (validEmails.length > 0) {
      const bulkOps = validEmails.map((emailData) => ({
        updateOne: {
          filter: { userId, gmailMessageId: emailData.gmailMessageId },
          update: { $set: emailData },
          upsert: true,
        },
      }));

      await Email.bulkWrite(bulkOps);
      saved += validEmails.length;

      // Phase 11 aggregate counters (derived from real persisted decisions)
      for (const d of validEmails) {
        if (d.classificationSource === "context") contextStats.applied += 1;
        else if (d.contextMeta && d.contextMeta.applied === false) contextStats.insufficient += 1;
      }
    }

    const processed = Math.min(i + BATCH_SIZE, newMessages.length);

    if (onProgress) {
      await onProgress(processed, total, saved, errors);
    }

    logger.debug({ processed, total, saved, errors }, "Batch processed");
  }

  // Aggregate Phase 11 context metrics for the worker summary
  const loaderStats = contextLoader.getStats();
  Object.assign(contextStats, {
    queriesRun: loaderStats.queriesRun,
    domainQueriesRun: loaderStats.domainQueriesRun,
    threadQueriesRun: loaderStats.threadQueriesRun,
    memoHits: loaderStats.memoHits,
  });

  if (deletedIds.length > 0) {
    const deleteResult = await Email.deleteMany({ userId, gmailMessageId: { $in: deletedIds } });
    logger.info(`[EmailSyncService] 🗑️ Deleted ${deleteResult.deletedCount} emails from MongoDB (permanently deleted in Gmail)`);
  }

  user.syncState.totalSynced = (user.syncState.totalSynced || 0) + saved;

  // ── O-H1: never advance Gmail state past partially failed ingestion ────
  // A run with fetch errors retains the previous history cursor AND resume
  // token so the failed window is re-processed next poll (upserts make
  // redelivery harmless). After POISON_WINDOW_RUNS consecutive errored runs
  // we advance anyway and surface the loss via `poisonWindow`.
  const { advance, gaveUp, newStreak } = shouldAdvanceCursor({
    errors,
    previousErroredRuns: user.syncState.erroredRuns || 0,
  });
  user.syncState.erroredRuns = newStreak;

  if (advance) {
    user.syncState.nextPageToken = nextPageToken;
    if (syncType === "incremental" && !didFallback && incrementalHistoryId) {
      user.lastHistoryId = incrementalHistoryId;
    } else if (!hasPendingPages) {
      user.lastHistoryId = await getCurrentHistoryId(gmail);
    }
  }
  // The in-flight chunk chain is unaffected either way: it follows the
  // RETURNED nextPageToken; only the persisted resume state is gated.

  // Persist run results atomically — guarded on lock ownership so a job
  // that lost its lock to stale-takeover cannot clobber the newer run.
  await persistRunResults(userId, jobId, {
    "syncState.totalSynced": user.syncState.totalSynced,
    "syncState.nextPageToken": user.syncState.nextPageToken ?? null,
    "syncState.erroredRuns": user.syncState.erroredRuns,
    lastHistoryId: user.lastHistoryId ?? null,
  });

  return {
    isEmpty: false,
    saved,
    skipped,
    errors,
    deletedCount: deletedIds.length,
    failedMessageIds, // capped at 50 — structured identity for ops diagnosis
    partial: errors > 0,
    poisonWindow: gaveUp && errors > 0,
    contextStats,
    aiStats,
    hasMore: !!nextPageToken,
    hasPendingPages,
    totalSynced: user.syncState.totalSynced
  };
}

// Exported for verification tooling — real ingestion implementation.
module.exports = { runSync, loadUserPreferences, processEmail };

if (process.env.NODE_ENV === "test") {
  module.exports.fetchIncrementalMessageIds = fetchIncrementalMessageIds;
}
