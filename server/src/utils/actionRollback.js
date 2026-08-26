/**
 * Rollback-metadata resolver for email-action jobs.
 *
 * Supports BOTH payload shapes:
 *   - Phase 3+ snapshot:  { restoreInboxIds, restoreNotDeletedIds }
 *   - Legacy (Phase 2):   { mongoIds } or bare data.emailId
 */
const Email = require("../models/Email");

/**
 * Restrict a rollback payload to ONLY the Gmail IDs whose mutation failed.
 *
 * Single shared entry point for partial bulk-action failure (O-C1):
 *   1. maps failed Gmail message ids → Mongo _ids safely (scoped to the
 *      user; unknown/missing ids simply contribute nothing)
 *   2. delegates to the pure restrictor so successful mutations can never
 *      be reverted and unrelated emails are never touched
 *
 * @param {object} data  original job payload (snapshot or legacy)
 * @param {{ userId: string, failedGmailIds: string[] }} p
 * @returns {Promise<object|null>} restricted payload (possibly empty ⇒
 *                                 reconcile is a no-op), or null when nothing
 *                                 failed / no known convention.
 */
async function restrictRollbackToFailedGmailIds(data, { userId, failedGmailIds } = {}) {
  // Accept the owner id from either position; never guess.
  const effectiveUserId = userId || data?.userId;
  if (!Array.isArray(failedGmailIds) || failedGmailIds.length === 0) return null;
  if (!effectiveUserId) {
    throw new Error(
      "restrictRollbackToFailedGmailIds requires a userId (opts or payload)"
    );
  }

  const docs = await Email.find(
    { userId: effectiveUserId, gmailMessageId: { $in: failedGmailIds } },
    { _id: 1 }
  ).lean();

  const restricted = restrictRollbackToFailed(
    data,
    docs.map((d) => d._id.toString())
  );

  // Self-consistency: the restricted payload must ALWAYS carry a usable
  // userId, even if the original snapshot omitted it — otherwise every
  // downstream query would silently match nothing (Mongoose treats
  // `userId: undefined` as a null-constraint, not as "absent").
  if (restricted && !restricted.userId) restricted.userId = effectiveUserId;

  return restricted;
}

/**
 * Resolve effective rollback ids for a job payload.
 *
 * Legacy fallback semantics:
 *   - delete-family actions restore isDeleted=false for every listed id
 *   - archive-family actions $addToSet INBOX for every listed id
 *     (Phase 2 bulk snapshots listed all matched ids regardless of prior
 *      INBOX membership; re-inboxing an edge-case already-archived mail was
 *      accepted for that transition window rather than silently dropping a
 *      legitimate revert)
 */
function resolveRollbackIds(data = {}) {
  const legacyIds = Array.isArray(data.mongoIds) && data.mongoIds.length
    ? data.mongoIds
    : data.emailId
      ? [data.emailId]
      : [];

  const archiveIds = data.restoreInboxIds?.length
    ? data.restoreInboxIds
    : isArchiveFamily(data.action) ? legacyIds : [];

  const notDeletedIds = data.restoreNotDeletedIds?.length
    ? data.restoreNotDeletedIds
    : isDeleteFamily(data.action) ? legacyIds : [];

  return { archiveIds, notDeletedIds };
}

function isArchiveFamily(action) {
  return action === "archive" || action === "bulk-archive";
}

function isDeleteFamily(action) {
  return (
    action === "delete" || action === "bulk-trash" || action === "bulk-delete"
  );
}

/**
 * Restrict a rollback payload to ONLY the entries that failed on Gmail's side.
 *
 * Used when a BULK action partially succeeds: successful ids must NOT be
 * reverted (Gmail already applied them), while failed ids must be, so local
 * state never permanently diverges from Gmail.
 *
 * Supports both payload conventions:
 *   - Phase 3+ snapshots: filters restoreInboxIds / restoreNotDeletedIds
 *   - Legacy Phase 2:     filters mongoIds
 *
 * @returns {object|null} restricted payload with arrays filtered to the failed
 *                        subset (possibly empty ⇒ reconcile is a no-op), or
 *                        null when zero failures / no known convention.
 */
function restrictRollbackToFailed(data, failedMongoIds) {
  const set = new Set(failedMongoIds || []);
  if (set.size === 0) return null;

  const hasSnapshot =
    Array.isArray(data.restoreInboxIds) || Array.isArray(data.restoreNotDeletedIds);

  if (hasSnapshot) {
    return {
      userId: data.userId,
      action: data.action,
      restoreInboxIds: (data.restoreInboxIds || []).filter((id) => set.has(id)),
      restoreNotDeletedIds: (data.restoreNotDeletedIds || []).filter((id) => set.has(id)),
    };
  }

  if (Array.isArray(data.mongoIds)) {
    return {
      userId: data.userId,
      action: data.action,
      mongoIds: data.mongoIds.filter((id) => set.has(id)),
    };
  }

  return null;
}

module.exports = {
  resolveRollbackIds,
  restrictRollbackToFailed,
  restrictRollbackToFailedGmailIds,
};
