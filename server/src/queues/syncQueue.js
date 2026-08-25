const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

const syncQueue = new Queue("gmail-sync", { connection });

// ── Poller (repeatable live-tracking job) ───────────────────────────────────
//
// One repeatable incremental-sync job per user, deduped by deterministic
// jobId. Polling is a BACKUP for the Gmail Pub/Sub push webhook:
//   - armed after any sync that produced work / on login
//   - stopped automatically after IDLE_STOP_POLLS consecutive empty polls
//   - stopped immediately when the user's Gmail token is revoked
//   - re-armed by the next webhook push, login, or manual sync completion

const POLL_INTERVAL_MS = 60_000;
const POLLER_REGISTRY_KEY = "inboxit:active-pollers"; // SET of userIds (observability)
const IDLE_STOP_POLLS = 30; // consecutive empty polls before stopping (~30 min)

const pollJobId = (userId) => `poll:${userId}`;

/** Registry client (same Redis as the queue). */
async function queueClient() {
  return syncQueue.client;
}

const enqueueSyncJob = async (userId, type = "incremental") => {
  await syncQueue.add(
    "sync",
    { userId, type },
    {
      removeOnComplete: true,
      removeOnFail: { count: 3 },
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
    }
  );
  console.log(`Sync job enqueued for user ${userId} [${type}]`);
};

/** Idempotently arm the 60s repeating incremental sync for this user. */
const enqueuePeriodicSync = async (userId) => {
  await syncQueue.add(
    "sync",
    { userId, type: "incremental" },
    {
      repeat: { every: POLL_INTERVAL_MS },
      jobId: pollJobId(userId), // deduped — only one repeating job per user
      removeOnComplete: true,
      removeOnFail: { count: 3 },
    }
  );
  const client = await queueClient();
  await client.sadd(POLLER_REGISTRY_KEY, String(userId));
  console.log(`Periodic sync ensured for user ${userId} [every ${POLL_INTERVAL_MS / 1000}s]`);
};

/**
 * Remove this user's repeating poller. Idempotent — safe to call even if
 * already stopped. Uses the same (name, repeatOpts, jobId) triple as add(),
 * which BullMQ requires for deterministic removal.
 */
const stopPeriodicSync = async (userId) => {
  let removed = false;
  try {
    removed = await syncQueue.removeRepeatable(
      "sync",
      { every: POLL_INTERVAL_MS },
      pollJobId(userId)
    );
  } catch (err) {
    // Already-gone schedulers throw in some versions — treat as removed.
    if (!/does not exist|missing/i.test(err.message)) throw err;
  }

  const client = await queueClient();
  await client.srem(POLLER_REGISTRY_KEY, String(userId));

  console.log(`Periodic sync STOPPED for user ${userId}`);
  return true;
};

/** True if this user's live-tracking poller is currently armed. */
const isPollerActive = async (userId) => {
  const client = await queueClient();
  const active = await client.sismember(POLLER_REGISTRY_KEY, String(userId));
  return active === 1;
};

module.exports = {
  syncQueue,
  enqueueSyncJob,
  enqueuePeriodicSync,
  stopPeriodicSync,
  isPollerActive,
  pollJobId,
  POLLER_REGISTRY_KEY,
  IDLE_STOP_POLLS,
};
