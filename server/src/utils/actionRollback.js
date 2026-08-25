/**
 * Rollback-metadata resolver for email-action jobs.
 *
 * Supports BOTH payload shapes:
 *   - Phase 3+ snapshot:  { restoreInboxIds, restoreNotDeletedIds }
 *   - Legacy (Phase 2):   { mongoIds } or bare data.emailId
 *
 * Legacy fallback semantics:
 *   - delete-family actions restore isDeleted=false for every listed id
 *   - archive-family actions $addToSet INBOX for every listed id
 *     (Phase 2 bulk snapshots included all matched ids regardless of prior
 *      INBOX membership; re-inboxing an edge-case already-archived mail is
 *      accepted for this seconds-to-minutes transition window rather than
 *      silently dropping a legitimate revert)
 *
 * Single source of truth used by:
 *   - actionWorker.reconcileLocalAfterFailure  (final-failure rollback)
 *   - emailController.revertLocalAction        (undo/cancel rollback)
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

module.exports = { resolveRollbackIds, restrictRollbackToFailed };
