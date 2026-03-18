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

module.exports = { syncQueue, enqueueSyncJob };