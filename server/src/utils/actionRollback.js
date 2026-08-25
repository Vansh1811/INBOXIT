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

module.exports = { resolveRollbackIds };
