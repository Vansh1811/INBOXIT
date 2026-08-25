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
    console.log(`[Worker] 🟡 Job — userId=${userId}, type=${type}, attempt=${job.attemptsMade + 1}`);

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
      { new: true }
    );

    if (!user) {
      const existingUser = await User.findById(userId).select("syncState");
      if (!existingUser) throw new Error("User not found");
      
      console.log(`[Worker] ⚠️  Already syncing (started ${existingUser.syncState?.syncStartedAt}), skipping`);
      return { skipped: true };
    }

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
        console.error(`[Worker] ❌ Token invalid for ${userId} — live tracking stopped until re-login:`, safeDetail(err.originalError));
        safeEmit(userId, "sync:failed", { error: "Gmail access expired — please log in again." });
        throw err;
      }

      console.error(`[Worker] ❌ Sync failed:`, safeDetail(err));
      safeEmit(userId, "sync:failed", { error: err.message });
      throw err;
    }

    const { isEmpty, saved, skipped, errors, hasMore, hasPendingPages, totalSynced } = result;

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
          console.log(`[Worker] 💤 ${idlePolls} consecutive empty polls — live tracking stopped for user ${userId}`);
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
      console.error(`[Worker] Cache bust failed:`, e.message);
      return 0;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Worker] ✅ Done in ${elapsed}s — saved=${saved}, skipped=${skipped}, errors=${errors}, hasMore=${hasMore}, cacheBusted=${bustedKeys}`
    );

    safeEmit(userId, "sync:complete", { totalSynced, hasMore });

    // 5. THE LAZY LOAD HANDOFF
    if (hasMore || hasPendingPages) {
      console.log(`[Worker] 🟡 More pages remain. Enqueuing next chunk...`);
      await enqueueSyncJob(userId, hasPendingPages ? "full" : type);
    } else {
      console.log(`[Worker] 🟢 Sync complete! Ensuring live tracking...`);
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
    console.warn(`[Worker] ⚠️ Job ${jobId} stalled${userId ? ` (user ${userId})` : ""}`);
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
      console.log(`[Worker] 🔓 Released sync lock for stalled job of user ${userId}`);
    }

  } catch (err) {
    console.error("[Worker] stalled handler error:", err.message);
  }
});

worker.on("failed", (job, err) =>
  console.error(
    `[Worker] ❌ FAILED userId=${job?.data?.userId} attempt=${job?.attemptsMade}/${job?.opts?.attempts}:`,
    err.message
  )
);
worker.on("completed", (job) => console.log(`[Worker] ✅ Done userId=${job?.data?.userId}`));
worker.on("error", (err) => console.error(`[Worker] ❌ Worker error:`, err.message));

module.exports = { worker, setEmitter };
