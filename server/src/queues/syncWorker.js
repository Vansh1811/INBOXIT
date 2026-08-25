const { Worker } = require("bullmq");
const { redisClient } = require("../config/redis");
const { getIO } = require("../config/socket");
const User = require("../models/User");
const { enqueuePeriodicSync, enqueueSyncJob } = require("./syncQueue");
const { runSync } = require("../services/emailSyncService");

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
};

const safeEmit = (userId, event, payload) => {
  try {
    getIO().to(userId).emit(event, payload);
  } catch {
    // socket not ready — silently skip
  }
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

    console.log({
      lastHistoryId: user.lastHistoryId,
      lastHistoryIdType: typeof user.lastHistoryId,
      nextPageToken: user.syncState?.nextPageToken,
      nextPageTokenType: typeof user.syncState?.nextPageToken,
    });

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

    let result;
    try {
      // 3. Delegate to domain service
      result = await runSync({
        user,
        syncType: type,
        onProgress: async (processed, total, saved, errors) => {
          safeEmit(userId, "sync:progress", { saved, total });
          if (processed % 500 === 0 || processed === total) {
            await job.updateProgress(processed);
          }
        },
        onEmailProcessed: (email) => {
          safeEmit(userId, "email:new", email);
        }
      });
    } catch (err) {
      // Release lock on error
      user.syncState.isSyncing = false;
      await user.save();
      
      // Log only status codes / messages — never raw provider response bodies
      const safeDetail = (e) =>
        e?.response?.status ? `status=${e.response.status} ${e.message}` : e?.message;

      if (err.isTokenError) {
        console.error(`[Worker] ❌ Token refresh failed:`, safeDetail(err.originalError));
        safeEmit(userId, "sync:failed", { error: err.message });
        throw err;
      } else {
        console.error(`[Worker] ❌ Sync failed:`, safeDetail(err));
        safeEmit(userId, "sync:failed", { error: err.message });
        throw err;
      }
    }

    const { isEmpty, saved, skipped, errors, hasMore, hasPendingPages, totalSynced } = result;

    if (isEmpty) {
      user.syncState.isSyncing = false;
      user.lastSyncedAt = new Date();
      await user.save();
      safeEmit(userId, "sync:complete", { totalSynced, hasMore });
      
      if (!hasMore) {
        console.log(`[Worker] 🟢 Sync complete (empty)! Ensuring 60s Live Tracking...`);
        await enqueuePeriodicSync(userId);
      }
      return;
    }

    // Release lock on success
    user.syncState.isSyncing = false;
    user.lastSyncedAt = new Date();
    await user.save();

    // 4. Bust Redis cache
    const keys = await redisClient.keys(`user:${userId}:*`);
    if (keys.length) await redisClient.del(keys);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Worker] ✅ Done in ${elapsed}s — saved=${saved}, skipped=${skipped}, errors=${errors}, hasMore=${hasMore}`
    );

    safeEmit(userId, "sync:complete", {
      totalSynced,
      hasMore,
    });

    // 5. THE LAZY LOAD HANDOFF
    if (hasMore) {
      console.log(`[Worker] 🟡 More pages remain. Enqueuing next chunk...`);
      await enqueueSyncJob(userId, type);
    } else {
      console.log(`[Worker] 🟢 Sync complete! Ensuring 60s Live Tracking for new mail...`);
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
