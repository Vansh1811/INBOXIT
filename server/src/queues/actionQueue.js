const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

const actionQueue = new Queue("email-action", { connection });

/**
 * @param {string} userId
 * @param {string} emailKey       single email id, or a unique key like "bulk-<ts>"
 * @param {string|string[]} gmailMessageIds
 * @param {"delete"|"archive"|"bulk-trash"|"bulk-archive"} action
 * @param {object} [snapshot]     Minimum necessary state to accurately rollback
 *                                e.g. { restoreInboxIds: [], restoreNotDeletedIds: [] }
 */
const enqueueActionJob = async (userId, emailKey, gmailMessageIds, action, snapshot = null) => {
  const jobId = `action:${userId}:${emailKey}`;
  await actionQueue.add(
    "action",
    {
      userId,
      emailId: emailKey,
      gmailMessageId: gmailMessageIds,
      action,
      ...(snapshot ? snapshot : {}),
    },
    {
      delay: 5000, // 5 second delay for undo
      jobId, // Unique job ID so we can cancel it
      removeOnComplete: true,
      removeOnFail: { count: 3 },
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
    }
  );
  console.log(`Action job enqueued for ${emailKey} [${action}] (5s delay)`);
};

module.exports = { actionQueue, enqueueActionJob };
