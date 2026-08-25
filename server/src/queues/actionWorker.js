const { Worker } = require("bullmq");
const User = require("../models/User");
const Email = require("../models/Email");
const { getGmailClient } = require("../utils/gmailClient");
const { resolveRollbackIds, restrictRollbackToFailed } = require("../utils/actionRollback");
const { actionQueue } = require("./actionQueue");
const logger = require("../utils/logger").child({ component: "action-worker" });

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
    logger.info({ count: notDeletedIds.length }, "Reverted local delete after final failure");
  }

  if (archiveIds.length) {
    await Email.updateMany(
      { _id: { $in: archiveIds }, userId: data.userId },
      { $addToSet: { labels: "INBOX" } }
    );
    logger.info({ count: archiveIds.length }, "Reverted local archive after final failure");
  }
}

const actionWorker = new Worker(
  "email-action",
  async (job) => {
    const { userId, gmailMessageId, action } = job.data;
    const log = logger.child({ jobId: job.id, userId, action });
    const messageCount = Array.isArray(gmailMessageId) ? gmailMessageId.length : 1;
    log.info(`Processing ${action} (${messageCount} message(s))`);

    // Gmail ids whose batchModify failed during THIS attempt (bulk actions).
    const failedGmailIds = [];

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
        log.info(`Gmail archived: ${gmailMessageId}`);
      } else if (action === "delete") {
        await gmail.users.messages.trash({
          userId: "me",
          id: gmailMessageId,
        });
        log.info(`Gmail trashed: ${gmailMessageId}`);

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
            log.debug({ chunkSize: chunk.length }, "Bulk archive chunk applied");
          } catch (chunkErr) {
            // Track failures — a partially-successful job must NOT be treated
            // as fully successful (see failedGmailIds handling below).
            failedGmailIds.push(...chunk);
            logger.error({ userId, action, chunkIndex: i }, `Archive chunk failed: ${chunkErr.message}`);
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
            log.debug({ chunkSize: chunk.length }, "Bulk trash chunk applied");
          } catch (chunkErr) {
            failedGmailIds.push(...chunk);
            logger.error({ userId, action, chunkIndex: i }, `Trash chunk failed: ${chunkErr.message}`);
          }
        }

      } else {
        throw new Error(`Unknown action type: ${action}`);
      }

      // ── PARTIAL FAILURE HANDLING (O-C1) ────────────────────────────────
      // A bulk job where SOME chunks failed must never be reported as
      // successful with those ids silently skipped. Attach a rollback
      // payload restricted to the failed subset and throw:
      //   - non-final attempt → BullMQ retries the whole job (Gmail batch
      //     mutations are idempotent, so already-applied ids are no-ops)
      //   - final attempt → the catch below reconciles ONLY the failed ids
      if (failedGmailIds.length > 0) {
        const docs = await Email.find(
          { userId, gmailMessageId: { $in: failedGmailIds } },
          { _id: 1 }
        ).lean();
        const failedMongoIds = docs.map((d) => d._id.toString());
        const restricted = restrictRollbackToFailed(job.data, failedMongoIds);

        const err = new Error(
          `${action} partially failed for ${failedGmailIds.length}/${messageCount} message(s)`
        );
        err.rollbackData = restricted; // null ⇒ nothing restorable; final handler falls back safely
        throw err;
      }
    } catch (error) {
      const attempts = job.opts?.attempts ?? 1;
      // Inside the processor, attemptsMade counts PREVIOUS failed attempts —
      // the in-flight throw is attempt #attemptsMade+1.
      const isFinalFailure = job.attemptsMade + 1 >= attempts;

      log.error(
        { attempt: `${job.attemptsMade + 1}/${attempts}`, final: isFinalFailure },
        `Action failed: ${error.message}`
      );

      if (isFinalFailure) {
        // No retry left → make local state match reality. A partial-failure
        // error carries a rollback payload restricted to exactly the ids
        // whose Gmail mutation failed; full failures fall back to the
        // original job snapshot.
        const rollbackData = error.rollbackData || job.data;
        await reconcileLocalAfterFailure(rollbackData).catch((e) =>
          log.error(`Reconciliation failed: ${e.message}`)
        );
      }
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

actionWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "Action job completed")
);
actionWorker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, userId: job?.data?.userId, attempt: `${job?.attemptsMade}/${job?.opts?.attempts}` },
    `Action job failed: ${err.message}`
  )
);

module.exports = { actionWorker, reconcileLocalAfterFailure };
