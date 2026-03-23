const { Worker } = require("bullmq");
const { redisClient } = require("../config/redis");
const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classify } = require("../services/classifier");
const { getIO } = require("../config/socket");
const User = require("../models/User");
const Email = require("../models/Email");
const { enqueuePeriodicSync } = require("./syncQueue");

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
};

const CHUNK_SIZE = 500;
const BATCH_SIZE = 100;

const safeEmit = (userId, event, payload) => {
  try {
    getIO().to(userId).emit(event, payload);
  } catch {
    // socket not ready — silently skip
  }
};

// Inside src/queues/syncWorker.js

const processEmail = async (gmail, messageId, userId) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);
  
  // 1. Get your custom rule-based categories
  const customCategories = classify(from, subject);
  const categories = [...customCategories];
  
  // 2. Look at Gmail's native labels
  const gmailLabels = msg.labelIds || [];
  
  if (gmailLabels.includes("CATEGORY_PROMOTIONS")) categories.push("promotions");
  if (gmailLabels.includes("CATEGORY_SOCIAL")) categories.push("social");
  if (gmailLabels.includes("CATEGORY_UPDATES")) categories.push("updates");
  if (gmailLabels.includes("CATEGORY_FORUMS")) categories.push("forums");

  // 3. Remove duplicates
  let uniqueCategories = [...new Set(categories)];

  // 4. Cleanup: If we found a specific category, remove "uncategorized"
  if (uniqueCategories.length > 1) {
    uniqueCategories = uniqueCategories.filter(c => c !== "uncategorized");
  }

  const email = await Email.findOneAndUpdate(
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
      
      // Save the merged, clean categories array
      categories: uniqueCategories, 
      
      isRead:    !gmailLabels.includes("UNREAD"),
      isStarred:  gmailLabels.includes("STARRED") || false,
      labels:     gmailLabels,
    },
    { upsert: true, returnDocument: "after" }
  );

  return email;
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
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    for (const record of res.data.history || []) {
      (record.messagesAdded || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsAdded   || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsRemoved || []).forEach((m) => changedIds.add(m.message.id));
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

const refreshTokenIfNeeded = async (user) => {
  const tokenExpiry = new Date(user.tokenExpiry).getTime();
  const buffer = 2 * 60 * 1000;

  if (tokenExpiry > Date.now() + buffer) return;

  console.log(`[Worker] ⚠️  Token expiring — refreshing...`);
  const axios = require("axios");
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: user.refreshToken,
    grant_type:    "refresh_token",
  });

  user.accessToken = data.access_token;
  user.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  await user.save();
  console.log(`[Worker] ✅ Token refreshed`);
};

const getCurrentHistoryId = async (gmail) => {
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.historyId;
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
const worker = new Worker(
  "gmail-sync",
  async (job) => {
    const startTime = Date.now();
    const { userId, type } = job.data;
    console.log(`[Worker] 🟡 Job — userId=${userId}, type=${type}`);

    // 1. Load user
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    console.log(`[Worker] ✅ User: ${user.email}`);

    // 2. Prevent double sync (10-min stuck-lock auto-unlock)
    if (user.syncState?.isSyncing) {
      const syncStart = user.syncState?.syncStartedAt;
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (syncStart && syncStart > tenMinAgo) {
        console.log(`[Worker] ⚠️  Already syncing (started ${syncStart}), skipping`);
        return { skipped: true };
      }
      console.log(`[Worker] ⚠️  Previous sync was stuck — auto-unlocking`);
    }

    user.syncState.isSyncing     = true;
    user.syncState.syncStartedAt = new Date();
    await user.save();

    safeEmit(userId, "sync:started", { type });

    // 3. Refresh token
    try {
      await refreshTokenIfNeeded(user);
    } catch (err) {
      user.syncState.isSyncing = false;
      await user.save();
      console.error(`[Worker] ❌ Token refresh failed:`, err.response?.data || err.message);
      safeEmit(userId, "sync:failed", { error: "Token refresh failed. Re-login required." });
      throw new Error("Token refresh failed. User needs to re-login.");
    }

    const gmail = getGmailClient(user);

    // ── 4. Fetch message IDs ──────────────────────────────────────────────────
    //
    // KEY INVARIANT:
    //   True incremental only runs when ALL of these are true:
    //     ✅ type === "incremental"
    //     ✅ lastHistoryId exists
    //     ✅ nextPageToken is null  ← means full initial sync is complete
    //
    //   If nextPageToken is set, we still have pages left from the full sync.
    //   Even if type=incremental, we keep chunking from where we left off.
    //
    //   FIX: fallback resumes from user.syncState.nextPageToken, NOT null.
    //   Old bug: every fallback fetched page 1 → same 500 emails → infinite skip loop.
    // ─────────────────────────────────────────────────────────────────────────
    let messages      = [];
    // ✅ FIX: Actually grab the bookmark from the database!
    let nextPageToken = user.syncState?.nextPageToken || null;
    let didFallback   = false;

    const hasPendingPages = !!user.syncState?.nextPageToken;

    try {
      // 🔴 FIXED 2: We removed `&& !hasPendingPages` from this condition.
      // If BullMQ says "incremental", we MUST use the History API to look for 
      // new emails, even if a "Load More" token exists in the database.
      if (type === "incremental" && user.lastHistoryId) {
        // ── A: True incremental ───────────────────────────────────────────────
        console.log(`[Worker] Incremental sync (historyId=${user.lastHistoryId})...`);
        let incrementalMessages = [];

        try {
          incrementalMessages = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
          console.log(`[Worker] Incremental returned ${incrementalMessages.length} message(s)`);
        } catch (incErr) {
          const errMsg = incErr.response?.data?.error?.message || incErr.message;
          console.log(`[Worker] ⚠️  Incremental failed (${errMsg}) — falling back to chunk`);
          didFallback = true;
        }

 //if (!didFallback && incrementalMessages.length === 0) {
   //console.log(`[Worker] ⚠️  Incremental returned 0 — falling back to chunk`);
      //didFallback = true;
        //}

        if (!didFallback) {
          messages = incrementalMessages;
        } else {
          // Fallback uses the saved nextPageToken so we don't repeat page 1
          console.log(`[Worker] Fallback chunk (resumeToken=${nextPageToken ? "saved" : "fresh"})...`);
          const result = await fetchMessageChunk(gmail, nextPageToken);
          messages      = result.messages;
          nextPageToken = result.nextPageToken;
        }

        } else {
          // ── B: Chunked sync (For POST /sync and POST /load-more) ──────────
          console.log(`[Worker] Chunk sync (token=${nextPageToken ? "resume" : "fresh"})...`);
          const result = await fetchMessageChunk(gmail, nextPageToken);
          messages      = result.messages;
          nextPageToken = result.nextPageToken; // Updates with the new token
        }
      } catch (fetchErr) {
        user.syncState.isSyncing = false;
        await user.save();
        console.error(`[Worker] ❌ Fetch failed:`, fetchErr.response?.data || fetchErr.message);
        safeEmit(userId, "sync:failed", { error: fetchErr.message });
        throw fetchErr;
      }

      console.log(`[Worker] ${messages.length} messages to process`);

      // Nothing to sync
      if (messages.length === 0) {
        console.log(`[Worker] ✅ Nothing to sync`);
        user.lastHistoryId       = await getCurrentHistoryId(gmail);
        user.syncState.isSyncing = false;
        user.lastSyncedAt        = new Date();
        await user.save();
        safeEmit(userId, "sync:complete", { totalSynced: user.syncState.totalSynced || 0, hasMore: !!nextPageToken });
        return;
      }

    // 5. Deduplicate
    // Incremental (genuine, no fallback): always reprocess — catches label changes
    // Full / fallback / pending-pages: skip what's already in DB
    const allGmailIds = messages.map((m) => m.id);
    const isFull      = type !== "incremental" || didFallback || hasPendingPages;
    const existingIds = isFull
      ? await getExistingMessageIds(userId, allGmailIds)
      : new Set();

    const newMessages = messages.filter((m) => !existingIds.has(m.id));
    const skipped     = messages.length - newMessages.length;
    const total       = newMessages.length;

    console.log(`[Worker] Skipping ${skipped} already-synced, processing ${total} new`);

    // 6. Process in parallel batches
    let saved  = 0;
    let errors = 0;

    for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
      const batch = newMessages.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async ({ id }) => {
          try {
            const email = await processEmail(gmail, id, userId);
            saved++;

            // Only emit email:new for genuine incremental (not fallback/pending pages)
            if (type === "incremental" && !didFallback && !hasPendingPages) {
              safeEmit(userId, "email:new", {
                id:             email._id,
                gmailMessageId: email.gmailMessageId,
                from:           email.from,
                subject:        email.subject,
                category:       email.category,
                receivedAt:     email.receivedAt,
              });
            }
          } catch (err) {
            errors++;
            if (err?.response?.status === 404) {
              // deleted between list and get — skip silently
            } else {
              console.error(`[Worker] ❌ msg ${id}:`, err.response?.data?.error?.message || err.message);
            }
          }
        })
      );

      const processed = Math.min(i + BATCH_SIZE, newMessages.length);
      safeEmit(userId, "sync:progress", { saved, total });

      if (processed % 500 === 0 || processed === newMessages.length) {
        await job.updateProgress(processed);
      }
      console.log(`[Worker] ${processed}/${total} (saved=${saved}, errors=${errors})`);
    }

   // 7. Persist sync state
    user.syncState.totalSynced   = (user.syncState.totalSynced || 0) + saved;
    user.syncState.nextPageToken = nextPageToken; // Save the token for the "Load More" button
    user.lastHistoryId           = await getCurrentHistoryId(gmail);
    user.syncState.isSyncing     = false;
    user.lastSyncedAt            = new Date();
    await user.save();

    // 8. Bust Redis cache
    const keys = await redisClient.keys(`user:${userId}:*`);
    if (keys.length) await redisClient.del(keys);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Worker] ✅ Done in ${elapsed}s — saved=${saved}, skipped=${skipped}, errors=${errors}, hasMore=${!!nextPageToken}`
    );

    safeEmit(userId, "sync:complete", {
      totalSynced: user.syncState.totalSynced, // Send the running total to the frontend
      hasMore:     !!nextPageToken,
    });

    // 9. THE LAZY LOAD HANDOFF
    // If hasPendingPages was false when this job started, it means this was the 
    // very first initial sync. We start the 60s Live Tracker now.
    if (type === "full" && !hasPendingPages) {
      console.log(`[Worker] 🟢 Initial chunk synced! Starting 60s Live Tracking for new mail...`);
      await enqueuePeriodicSync(userId);
    }
  },
  {
    connection:   bullConnection,
    concurrency:  1,
    lockDuration: 10 * 60 * 1000,
  }
);

worker.on("failed",    (job, err) => console.error(`[Worker] ❌ FAILED userId=${job?.data?.userId}:`, err.message));
worker.on("completed", (job)      => console.log(`[Worker] ✅ Done userId=${job?.data?.userId}`));
worker.on("error",     (err)      => console.error(`[Worker] ❌ Worker error:`, err.message));

module.exports = worker;