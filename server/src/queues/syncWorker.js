const { Worker } = require("bullmq");
const { redisClient } = require("../config/redis");
const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classify } = require("../services/classifier");
const User = require("../models/User");
const Email = require("../models/Email");

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
};

// ─── CONFIG ───────────────────────────────────────────
const CHUNK_SIZE = 3000; // emails per sync job
const BATCH_SIZE = 100;  // concurrent Gmail API calls per batch
// ──────────────────────────────────────────────────────

// 🔥 PROCESS SINGLE EMAIL (UPSERT SAFE)
const processEmail = async (gmail, messageId, userId) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);
  const category = classify(from, subject) || "uncategorized";

  await Email.findOneAndUpdate(
    { userId, gmailMessageId: msg.id },
    {
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
      category,
      isRead: !msg.labelIds?.includes("UNREAD"),
      isStarred: msg.labelIds?.includes("STARRED") || false,
      labels: msg.labelIds || [],
    },
    { upsert: true, returnDocument: "after" }
  );
};

// 🔥 CHUNKED FETCH — fetches CHUNK_SIZE emails starting from pageToken
const fetchMessageChunk = async (gmail, pageToken = null, limit = CHUNK_SIZE) => {
  const allMessages = [];
  let currentPageToken = pageToken;

  while (allMessages.length < limit) {
    const batchSize = Math.min(100, limit - allMessages.length);

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: batchSize,
      labelIds: ["INBOX"],  // 🔥 only inbox emails
      ...(currentPageToken && { pageToken: currentPageToken }),
    });

    const messages = res.data.messages || [];
    allMessages.push(...messages);
    currentPageToken = res.data.nextPageToken;

    if (!currentPageToken || messages.length === 0) break;
  }

  return {
    messages: allMessages,
    nextPageToken: currentPageToken || null, // null = inbox fully synced
  };
};

// 🔥 INCREMENTAL SYNC
const fetchIncrementalMessageIds = async (gmail, startHistoryId) => {
  const changedIds = new Set();
  let pageToken;

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    const history = res.data.history || [];

    for (const record of history) {
      (record.messages || []).forEach((m) => changedIds.add(m.id));
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return [...changedIds].map((id) => ({ id }));
};

// 🔥 BULK SKIP — fetch all existing gmailMessageIds in ONE query
const getExistingMessageIds = async (userId, gmailIds) => {
  const existing = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds } },
    { gmailMessageId: 1 }
  ).lean();
  return new Set(existing.map((e) => e.gmailMessageId));
};

// 🔥 REFRESH TOKEN INSIDE WORKER
const refreshTokenIfNeeded = async (user) => {
  const tokenExpiry = new Date(user.tokenExpiry).getTime();
  const now = Date.now();
  const buffer = 2 * 60 * 1000; // 2 min buffer

  if (tokenExpiry > now + buffer) return; // still fresh

  console.log(`[Worker] ⚠️ Token expired/expiring. Refreshing...`);
  const axios = require("axios");
  const response = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: user.refreshToken,
    grant_type: "refresh_token",
  });

  const { access_token, expires_in } = response.data;
  user.accessToken = access_token;
  user.tokenExpiry = new Date(Date.now() + expires_in * 1000);
  await user.save();
  console.log(`[Worker] ✅ Token refreshed`);
};

// ─────────────────────────────────────────────────────
// 🔥 WORKER
// ─────────────────────────────────────────────────────
const worker = new Worker(
  "gmail-sync",
  async (job) => {
    const startTime = Date.now();
    const { userId, type } = job.data;
    console.log(`[Worker] 🟡 Job picked up — userId=${userId}, type=${type}`);

    // 1. Find user
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    console.log(`[Worker] ✅ User: ${user.email}`);

    // 2. 🔥 Prevent double sync (with auto-unlock after 10 min)
    if (user.syncState?.isSyncing) {
      const syncStart = user.syncState?.syncStartedAt;
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (syncStart && syncStart > tenMinAgo) {
        console.log(`[Worker] ⚠️ Already syncing (started ${syncStart}), skipping`);
        return { skipped: true };
      }
      console.log(`[Worker] ⚠️ Previous sync was stuck, auto-unlocking`);
    }
    user.syncState.isSyncing = true;
    user.syncState.syncStartedAt = new Date();
    await user.save();

    // 3. Refresh token if needed
    try {
      await refreshTokenIfNeeded(user);
    } catch (err) {
      user.syncState.isSyncing = false;
      await user.save();
      console.error(`[Worker] ❌ Token refresh failed:`, err.response?.data || err.message);
      throw new Error("Token refresh failed. User needs to re-login.");
    }

    const gmail = getGmailClient(user);

    // 4. Fetch message IDs
    let messages = [];
    let nextPageToken = null;

    try {
      if (type === "incremental" && user.lastHistoryId) {
        console.log(`[Worker] Incremental sync...`);
        messages = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
      } else {
        // full or load-more — resume from saved token
        const resumeToken = user.syncState?.nextPageToken || null;
        console.log(`[Worker] Chunk sync (token=${resumeToken ? "resume" : "fresh"})...`);

        const result = await fetchMessageChunk(gmail, resumeToken);
        messages = result.messages;
        nextPageToken = result.nextPageToken;
      }
    } catch (fetchErr) {
      user.syncState.isSyncing = false;
      await user.save();
      console.error(`[Worker] ❌ Failed to fetch messages:`, fetchErr.response?.data || fetchErr.message);
      throw fetchErr;
    }

    console.log(`[Worker] Found ${messages.length} messages to sync`);

    if (messages.length === 0) {
      console.log(`[Worker] ⚠️ Nothing to sync`);
      if (!user.lastHistoryId) {
        const profile = await gmail.users.getProfile({ userId: "me" });
        user.lastHistoryId = profile.data.historyId;
      }
      user.syncState.isSyncing = false;
      user.lastSyncedAt = new Date();
      await user.save();
      return;
    }

    // 5. 🔥 Bulk skip already-synced emails (ONE db query instead of N)
    const allGmailIds = messages.map((m) => m.id);
    const existingIds = type === "full"
      ? await getExistingMessageIds(userId, allGmailIds)
      : new Set();

    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    const skipped = messages.length - newMessages.length;

    console.log(`[Worker] Skipping ${skipped} already-synced, processing ${newMessages.length} new emails`);

    // 6. Process in parallel batches
    let saved = 0;
    let errors = 0;

    for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
      const batch = newMessages.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async ({ id }) => {
          try {
            await processEmail(gmail, id, userId);
            saved++;
          } catch (err) {
            errors++;
            if (err?.response?.status === 404) {
              // message deleted between list and get — skip silently
            } else {
              console.error(`[Worker] ❌ msg ${id}:`, err.response?.data?.error?.message || err.message);
            }
          }
        })
      );

      const processed = Math.min(i + BATCH_SIZE, newMessages.length);
      if (processed % 500 === 0 || processed === newMessages.length) {
        await job.updateProgress(processed);
      }
      console.log(`[Worker] ${processed}/${newMessages.length} (saved=${saved}, errors=${errors})`);
    }

    // 7. Save sync state
    if (type !== "incremental") {
      user.syncState.nextPageToken = nextPageToken;
      user.syncState.totalSynced = (user.syncState.totalSynced || 0) + saved;

      // Grab historyId only on very first sync
      if (!user.lastHistoryId) {
        const profile = await gmail.users.getProfile({ userId: "me" });
        user.lastHistoryId = profile.data.historyId;
      }
    } else {
      const profile = await gmail.users.getProfile({ userId: "me" });
      user.lastHistoryId = profile.data.historyId;
    }

    user.syncState.isSyncing = false;
    user.lastSyncedAt = new Date();
    await user.save();

    // 8. Clear cache
    const keys = await redisClient.keys(`user:${userId}:*`);
    if (keys.length) await redisClient.del(keys);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Worker] ✅ Done in ${elapsed}s — saved=${saved}, skipped=${skipped}, errors=${errors}, hasMore=${!!nextPageToken}`);
  },
  {
    connection: bullConnection,
    concurrency: 1,
    lockDuration: 10 * 60 * 1000,
  }
);

// 🔥 EVENT HANDLERS
worker.on("failed", (job, err) => {
  console.error(`[Worker] ❌ FAILED userId=${job?.data?.userId}:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[Worker] ✅ Job completed for userId=${job?.data?.userId}`);
});

worker.on("error", (err) => {
  console.error(`[Worker] ❌ Worker error:`, err.message);
});

module.exports = worker;