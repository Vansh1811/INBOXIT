const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

const syncQueue = new Queue("gmail-sync", { connection });

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

// ✅ NEW — starts a repeating incremental sync every 60s for this user
const enqueuePeriodicSync = async (userId) => {
  await syncQueue.add(
    "sync",
    { userId, type: "incremental" },
    {
      repeat: { every: 60_000 },
      jobId: `poll:${userId}`,   // deduped — only one repeating job per user
      removeOnComplete: true,
      removeOnFail: { count: 3 },
    }
  );
  console.log(`Periodic sync started for user ${userId} [every 60s]`);
};

module.exports = { syncQueue, enqueueSyncJob, enqueuePeriodicSync };