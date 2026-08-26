const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classify, fromGmailTabs } = require("./classifier");
const { UNCATEGORIZED } = require("./categories");
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
const loadUserPreferences = async (userId) => {
  const prefs = await CategoryPreference.find({ userId })
    .select("senderDomain category")
    .lean();
  return Object.fromEntries(prefs.map((p) => [p.senderDomain, p.category]));
};

const processEmail = async (gmail, messageId, userId, userPrefs = {}, overriddenIds = new Set()) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);

  const gmailLabels = msg.labelIds || [];

  // 1. Rule-based / learned-preference classification (single winner)
  let category = classify(from, subject, userPrefs);

  // 2. Fall back to Gmail's own tab when our rules found nothing
  if (category === UNCATEGORIZED) {
    category = fromGmailTabs(gmailLabels) || UNCATEGORIZED;
  }

  // Never clobber a category the user set manually
  const preserveCategory = overriddenIds.has(msg.id);

  return {
    userId,
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    from,
    to,
    subject,
    snippet: msg.snippet,
    bodyHtml,
    bodyText,
    receivedAt: new Date(parseInt(msg.internalDate)),
    ...(preserveCategory ? {} : { category }),
    isRead:    !gmailLabels.includes("UNREAD"),
    isStarred:  gmailLabels.includes("STARRED") || false,
    isDeleted:  gmailLabels.includes("TRASH"),
    labels:     gmailLabels,
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

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved", "messageDeleted"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    for (const record of res.data.history || []) {
      (record.messagesAdded || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsAdded   || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsRemoved || []).forEach((m) => changedIds.add(m.message.id));
      (record.messagesDeleted || []).forEach((m) => changedIds.add(m.message.id));
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return [...changedIds].map((id) => ({ id }));
};

const getExistingMessageIds = async (userId, gmailIds) => {
  const existing = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds } },
    { gmailMessageId: 1 }
  ).lean();
  return new Set(existing.map((e) => e.gmailMessageId));
};

/** Gmail ids whose category the user has manually overridden. */
const getOverriddenMessageIds = async (userId, gmailIds) => {
  if (!gmailIds.length) return new Set();
  const docs = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds }, userOverride: true },
    { gmailMessageId: 1 }
  ).lean();
  return new Set(docs.map((e) => e.gmailMessageId));
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

  const hasPendingPages = !!user.syncState?.nextPageToken;

  if (syncType === "incremental" && user.lastHistoryId) {
    logger.info(`[EmailSyncService] Incremental sync (historyId=${user.lastHistoryId})...`);
    let incrementalMessages = [];

    try {
      incrementalMessages = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
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

  if (messages.length === 0) {
    logger.info(`[EmailSyncService] ✅ Nothing to sync`);
    user.lastHistoryId = await getCurrentHistoryId(gmail);
    user.syncState.erroredRuns = 0; // an empty poll is a successful poll
    await persistRunResults(userId, jobId, {
      lastHistoryId: user.lastHistoryId,
      "syncState.erroredRuns": 0,
    });
    return {
      isEmpty: true,
      hasMore: !!nextPageToken,
      hasPendingPages,
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
  const [userPrefs, overriddenIds] = await Promise.all([
    loadUserPreferences(userId),
    getOverriddenMessageIds(userId, allGmailIds),
  ]);

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
          return await processEmail(gmail, id, userId, userPrefs, overriddenIds);
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
    }

    const processed = Math.min(i + BATCH_SIZE, newMessages.length);

    if (onProgress) {
      await onProgress(processed, total, saved, errors);
    }

    logger.debug({ processed, total, saved, errors }, "Batch processed");
  }

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
    if (syncType === "incremental" || !hasPendingPages) {
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
    hasMore: !!nextPageToken,
    hasPendingPages,
    totalSynced: user.syncState.totalSynced
  };
}

module.exports = { runSync };
