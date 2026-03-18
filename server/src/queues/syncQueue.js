const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
};

const syncQueue = new Queue("gmail-sync", { connection });

const enqueueSyncJob = async (userId, type = "incremental") => {
  await syncQueue.add(
    "sync",
    { userId, type },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
  console.log(`Sync job enqueued for user ${userId} [${type}]`);
};

module.exports = { syncQueue, enqueueSyncJob };
