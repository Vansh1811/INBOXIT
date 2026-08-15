const { Worker } = require("bullmq");
const User = require("../models/User");
const { getGmailClient } = require("../utils/gmailClient");
const { actionQueue } = require("./actionQueue");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

const actionWorker = new Worker(
  "email-action",
  async (job) => {
    const { userId, gmailMessageId, action } = job.data;
    console.log(`[Worker] Processing action ${action} for ${gmailMessageId}`);

    try {
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      const gmail = await getGmailClient(user);

      if (action === "archive") {
        await gmail.users.messages.modify({
          userId: "me",
          id: gmailMessageId,
          requestBody: { removeLabelIds: ["INBOX"] },
        });
        console.log(`[Gmail] Archived: ${gmailMessageId}`);
      } else if (action === "delete") {
        await gmail.users.messages.trash({
          userId: "me",
          id: gmailMessageId,
        });
        console.log(`[Gmail] Trashed: ${gmailMessageId}`);
      } else if (action === "bulk-archive" || action === "bulk-delete") {
        const messageIds = Array.isArray(gmailMessageId) ? gmailMessageId : [gmailMessageId];
        // chunk into 1000s
        const chunkSize = 1000;
        for (let i = 0; i < messageIds.length; i += chunkSize) {
          const chunk = messageIds.slice(i, i + chunkSize);
          try {
            if (action === "bulk-archive") {
              await gmail.users.messages.batchModify({
                userId: "me",
                requestBody: { ids: chunk, removeLabelIds: ["INBOX"] },
              });
              console.log(`[Gmail] Bulk Archived chunk of ${chunk.length}`);
            } else if (action === "bulk-delete") {
              await gmail.users.messages.batchDelete({
                userId: "me",
                requestBody: { ids: chunk },
              });
              console.log(`[Gmail] Bulk Trashed chunk of ${chunk.length}`);
            }
          } catch (chunkErr) {
            console.error(`[Worker Error] Failed chunk ${i} for ${action}:`, chunkErr.message);
            // Log partial failure but continue remaining chunks
          }
        }
      }
    } catch (error) {
      console.error(`[Worker Error] Failed to process action ${action}:`, error.message);
      throw error;
    }
  },
  { connection }
);

actionWorker.on("completed", (job) => {
  console.log(`Action job completed: ${job.id}`);
});

actionWorker.on("failed", (job, err) => {
  console.error(`Action job failed: ${job.id}`, err.message);
});
