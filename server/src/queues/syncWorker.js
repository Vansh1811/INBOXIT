const { Worker } = require("bullmq");
const { redisClient } = require("../config/redis");
const User = require("../models/User");
const {
  enqueuePeriodicSync,
  enqueueSyncJob,
  stopPeriodicSync,
  IDLE_STOP_POLLS,
} = require("./syncQueue");
const { scanAndDelete } = require("../utils/cacheBust");
const { runSync } = require("../services/emailSyncService");
const logger = require("../utils/logger").child({ component: "sync-worker" });

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
};

// socket.io may not be initialized when jobs run outside the HTTP server
let emitFn = null;
const setEmitter = (fn) => { emitFn = fn; };
const safeEmit = (userId, event, payload) => {
  try { emitFn?.(userId, event, payload); } catch { /* socket not ready — skip */ }
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
const worker = new Worker(
  "gmail-sync",
  async (job) => {
    const startTime = Date.now();
    const { userId, type } = job.data;
    logger.info(`[Worker] 🟡 Job — userId=${userId}, type=${type}, attempt=${job.attemptsMade + 1}`);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

    // 1. & 2. Load user AND acquire lock atomically
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { "syncState.isSyncing": { $ne: true } },
          { "syncState.syncStartedAt": { $lt: tenMinAgo } }
        ]
      },
      {
        $set: {
          "syncState.isSyncing": true,
          "syncState.syncStartedAt": new Date(),
          "syncState.activeJobId": job.id || null
        }
      },
      { returnDocument: "after" }
    );

    if (!user) {
      const existingUser = await User.findById(userId).select("syncState");
      if (!existingUser) throw new Error("User not found");
      
      logger.info(`[Worker] ⚠️  Already syncing (started ${existingUser.syncState?.syncStartedAt}), skipping`);
      return { skipped: true };
    }

    safeEmit(userId, "sync:started", { type });

    let result;
    try {
      // 3. Delegate to domain service (jobId ⇒ ownership-guarded persistence)
      result = await runSync({
        user,
        syncType: type,
        jobId: job.id,
        onProgress: async (processed, total, saved, errors) => {
          safeEmit(userId, "sync:progress", { saved, total });
          if (processed % 500 === 0 || processed === total) {
            await job.updateProgress(processed);
          }
        },
      });
    } catch (err) {
      // Release lock on error — OWNERSHIP-GUARDED: this job may only clear
      // the lock it still holds. If the stale-takeover clause handed the
      // lock to a newer job, this update matches nothing and is a no-op.
      await User.updateOne(
        {
          _id: userId,
          "syncState.activeJobId": job.id
        },
        {
          $set: {
            "syncState.isSyncing": false,
            "syncState.activeJobId": null
          }
        }
      );

      // Log only status codes / messages — never raw provider response bodies
      const safeDetail = (e) =>
        e?.response?.status ? `status=${e.response.status} ${e.message}` : e?.message;

      if (err.isTokenError) {
        // Revoked/expired refresh token: polling would hammer Google with 401s
        // forever. Stop live tracking — the next login re-arms it.
        await stopPeriodicSync(userId).catch(() => {});
        logger.error(`[Worker] ❌ Token invalid for ${userId} — live tracking stopped until re-login:`, safeDetail(err.originalError));
        safeEmit(userId, "sync:failed", { error: "Gmail access expired — please log in again." });
        throw err;
      }

      logger.error(`[Worker] ❌ Sync failed:`, safeDetail(err));
      safeEmit(userId, "sync:failed", { error: err.message });
      throw err;
    }

    const {
      isEmpty,
      saved,
      skipped,
      errors,
      deletedCount,
      failedMessageIds = [],
      hasMore,
      hasPendingPages,
      totalSynced,
    } = result;

    if (isEmpty) {
      // ── IDLE BACKOFF ──────────────────────────────────────────────────
      // Count consecutive empty polls; stop live-tracking after the
      // threshold (~30 min idle). Any webhook push, login, or manual sync
      // produces work later → completion path re-arms the poller.
      const idlePolls = (user.syncState.idlePolls || 0) + 1;

      // OWNERSHIP-GUARDED release + activity bookkeeping in one atomic op.
      // If stale takeover handed the lock to a newer job, this matches
      // nothing and neither the lock NOR the stats are written — the newer
      // run owns both now.
      await User.updateOne(
        {
          _id: userId,
          "syncState.activeJobId": job.id
        },
        {
          $set: {
            "syncState.isSyncing": false,
            "syncState.activeJobId": null,
            "syncState.idlePolls": idlePolls,
            lastSyncedAt: new Date()
          }
        }
      );

      safeEmit(userId, "sync:complete", { totalSynced, hasMore });

      if (!hasMore && !hasPendingPages) {
        if (idlePolls >= IDLE_STOP_POLLS) {
          await stopPeriodicSync(userId);
          logger.info(`[Worker] 💤 ${idlePolls} consecutive empty polls — live tracking stopped for user ${userId}`);
          return;
        }
        await enqueuePeriodicSync(userId);
      }
      return;
    }

    // Real work happened → reset the idle streak. Same ownership guard:
    // a stale job that lost its lock to takeover writes nothing.
    await User.updateOne(
      {
        _id: userId,
        "syncState.activeJobId": job.id
      },
      {
        $set: {
          "syncState.isSyncing": false,
          "syncState.activeJobId": null,
          "syncState.idlePolls": 0,
          lastSyncedAt: new Date()
        }
      }
    );

    // 4. Bust Redis cache (SCAN-based — never KEYS)
    const bustedKeys = await scanAndDelete(redisClient, `user:${userId}:*`).catch((e) => {
      logger.error(`[Worker] Cache bust failed:`, e.message);
      return 0;
    });

    const elapsedMs = Date.now() - startTime;
    logger.info(
      {
        userId,
        saved,
        skipped,
        errors,
        deletedCount,
        // O-B1: capped identity list so errors=N is diagnosable safely
        failedMessageIds: failedMessageIds.slice(0, 20),
        hasMore,
        cursorRetained: errors > 0 && !result.poisonWindow,
        poisonWindow: result.poisonWindow === true,
        cacheBusted: bustedKeys,
        durationMs: elapsedMs,
      },
      "Sync finished"
    );

    safeEmit(userId, "sync:complete", { totalSynced, hasMore });

      // O-M5/O-H1: surface partial ingestion instead of silently swallowing it
      if (errors > 0) {
        safeEmit(userId, "sync:partial", {
          errors,
          deletedCount,
          poisonWindow: result.poisonWindow === true,
          message: result.poisonWindow === true
            ? `${errors} email(s) could not be loaded after repeated attempts.`
            : `${errors} email(s) could not be loaded — will retry automatically.`,
        });
      }

    // 5. THE LAZY LOAD HANDOFF
    if (hasMore || hasPendingPages) {
      logger.info(`[Worker] 🟡 More pages remain. Enqueuing next chunk...`);
      await enqueueSyncJob(userId, hasPendingPages ? "full" : type);
    } else {
      logger.info(`[Worker] 🟢 Sync complete! Ensuring live tracking...`);
      await enqueuePeriodicSync(userId);
    }
  },
  {
    connection:   bullConnection,
    concurrency:  4,             // parallel users; same-user overlap blocked by isSyncing lock
    lockDuration: 10 * 60 * 1000,
  }
);

// A stalled job (process died mid-run) must release its user's sync lock so
// subsequent syncs aren't blocked until the 10-minute auto-unlock, BUT only
// if it actually owns the lock.
worker.on("stalled", async (jobId) => {
  try {
    const job = await require("./syncQueue").syncQueue.getJob(jobId);
    const userId = job?.data?.userId;
    logger.warn(`[Worker] ⚠️ Job ${jobId} stalled${userId ? ` (user ${userId})` : ""}`);
    if (!userId) return;

    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        "syncState.isSyncing": true,
        "syncState.activeJobId": jobId
      },
      {
        $set: {
          "syncState.isSyncing": false,
          "syncState.activeJobId": null
        }
      }
    );

    if (updated) {
      logger.info(`[Worker] 🔓 Released sync lock for stalled job of user ${userId}`);
    }

  } catch (err) {
    logger.error("[Worker] stalled handler error:", err.message);
  }
});

worker.on("failed", (job, err) =>
  logger.error(
    `[Worker] ❌ FAILED userId=${job?.data?.userId} attempt=${job?.attemptsMade}/${job?.opts?.attempts}:`,
    err.message
  )
);
worker.on("completed", (job) => logger.info(`[Worker] ✅ Done userId=${job?.data?.userId}`));
worker.on("error", (err) => logger.error(`[Worker] ❌ Worker error:`, err.message));

module.exports = { worker, setEmitter };
