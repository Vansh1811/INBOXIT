const { Worker } = require("bullmq");
const User = require("../models/User");
const Email = require("../models/Email");
const { getGmailClient } = require("../utils/gmailClient");
const { resolveRollbackIds } = require("../utils/actionRollback");
const { actionQueue } = require("./actionQueue");

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: null,
};

/**
 * Undo the IMMEDIATE local mutation applied when an action was queued.
 * Called only on the FINAL failed attempt so MongoDB reflects Gmail's actual
 * state (the mutation did not go through). If Gmail later applies a stale
 * retry anyway, the next incremental sync reconciles from its labels.
 *
 * Exported for verification tooling — this IS the production implementation.
 */
async function reconcileLocalAfterFailure(data) {
  const { archiveIds, notDeletedIds } = resolveRollbackIds(data);

  if (notDeletedIds.length) {
    await Email.updateMany(
      { _id: { $in: notDeletedIds }, userId: data.userId },
      { isDeleted: false }
    );
    console.log(`[ActionWorker] ↩️  Reverted local delete for ${notDeletedIds.length} email(s)`);
  }

  if (archiveIds.length) {
    await Email.updateMany(
      { _id: { $in: archiveIds }, userId: data.userId },
      { $addToSet: { labels: "INBOX" } }
    );
    console.log(`[ActionWorker] ↩️  Reverted local archive for ${archiveIds.length} email(s)`);
  }
}

const actionWorker = new Worker(
  "email-action",
  async (job) => {
    const { userId, gmailMessageId, action } = job.data;
    console.log(`[ActionWorker] ${action} for ${Array.isArray(gmailMessageId) ? gmailMessageId.length + " message(s)" : gmailMessageId}`);

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

      } else if (action === "bulk-archive") {
        const messageIds = Array.isArray(gmailMessageId) ? gmailMessageId : [gmailMessageId];
        const chunkSize = 1000;
        for (let i = 0; i < messageIds.length; i += chunkSize) {
          const chunk = messageIds.slice(i, i + chunkSize);
          try {
            await gmail.users.messages.batchModify({
              userId: "me",
              requestBody: { ids: chunk, removeLabelIds: ["INBOX"] },
            });
            console.log(`[Gmail] Bulk Archived chunk of ${chunk.length}`);
          } catch (chunkErr) {
            // Log partial failure but continue remaining chunks
            console.error(`[ActionWorker] Archive chunk ${i} failed:`, chunkErr.message);
          }
        }

      } else if (action === "bulk-trash" || action === "bulk-delete") {
        // TRASH semantics — identical to single delete. Never permanently delete.
        const messageIds = Array.isArray(gmailMessageId) ? gmailMessageId : [gmailMessageId];
        const chunkSize = 1000;
        for (let i = 0; i < messageIds.length; i += chunkSize) {
          const chunk = messageIds.slice(i, i + chunkSize);
          try {
            await gmail.users.messages.batchModify({
              userId: "me",
              requestBody: { ids: chunk, addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] },
            });
            console.log(`[Gmail] Bulk Trashed chunk of ${chunk.length}`);
          } catch (chunkErr) {
            console.error(`[ActionWorker] Trash chunk ${i} failed:`, chunkErr.message);
          }
        }

      } else {
        throw new Error(`Unknown action type: ${action}`);
      }
    } catch (error) {
      const attempts = job.opts?.attempts ?? 1;
      // Inside the processor, attemptsMade counts PREVIOUS failed attempts —
      // the in-flight throw is attempt #attemptsMade+1.
      const isFinalFailure = job.attemptsMade + 1 >= attempts;

      console.error(
        `[ActionWorker] Failed ${action} (attempt ${job.attemptsMade + 1}/${attempts}):`,
        error.message
      );

      if (isFinalFailure) {
        // No retry left → make local state match reality.
        await reconcileLocalAfterFailure(job.data).catch((e) =>
          console.error("[ActionWorker] Reconciliation failed:", e.message)
        );
      }
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

actionWorker.on("completed", (job) => console.log(`Action job completed: ${job.id}`));
actionWorker.on("failed", (job, err) =>
  console.error(`Action job failed: ${job?.id}`, err.message)
);

module.exports = { actionWorker, reconcileLocalAfterFailure };
