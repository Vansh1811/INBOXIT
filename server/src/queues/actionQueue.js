const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

const actionQueue = new Queue("email-action", { connection });

const enqueueActionJob = async (userId, emailId, gmailMessageId, action) => {
  const jobId = `action:${userId}:${emailId}`;
  await actionQueue.add(
    "action",
    { userId, emailId, gmailMessageId, action },
    {
      delay: 5000, // 5 second delay for undo
      jobId, // Unique job ID so we can cancel it
      removeOnComplete: true,
      removeOnFail: { count: 3 },
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
    }
  );
  console.log(`Action job enqueued for ${emailId} [${action}] (5s delay)`);
};

module.exports = { actionQueue, enqueueActionJob };
