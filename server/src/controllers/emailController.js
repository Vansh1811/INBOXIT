const Email = require("../models/Email");
const CategoryPreference = require("../models/CategoryPreference");
const { redisClient } = require("../config/redis");
const { isValidCategory, extractSenderDomain } = require("../services/categories");
const { scanAndDelete } = require("../utils/cacheBust");
const { resolveRollbackIds } = require("../utils/actionRollback");
const { encodeCursor, decodeCursor, keysetBoundary } = require("../utils/cursor");
const logger = require("../utils/logger").child({ component: "email-controller" });

/**
 * FOLDER CONTRACT
 * ---------------
 * Special folders map to explicit state queries; any other slug must be a
 * canonical category from services/categories.js. Unknown slugs are rejected
 * with 400 instead of silently returning an empty list.
 */
const SPECIAL_FOLDERS = {
  inbox:   () => ({ labels: "INBOX" }),
  pinned:  () => ({ isStarred: true }),
  unread:  () => ({ labels: "INBOX", isRead: false }),
  archive: () => ({ labels: { $ne: "INBOX" } }),
  trash:   () => ({ isDeleted: true }),
};

const buildFolderQuery = (folder) => {
  const slug = String(folder || "inbox").toLowerCase();

  if (SPECIAL_FOLDERS[slug]) return SPECIAL_FOLDERS[slug]();
  if (isValidCategory(slug)) return { category: slug };
  return null;
};

/** Fields returned for list rows (never bodyHtml/bodyText). */
const LIST_PROJECTION = "from subject snippet receivedAt isRead isStarred category userOverride labels";

/** Invalidate all cached folder listings for this user (SCAN — never KEYS). */
const bustFolderCache = async (userId) => {
  await scanAndDelete(redisClient, `user:${userId}:folder:*`).catch((e) =>
    logger.warn({ userId, err: e.message }, "Folder cache bust failed")
  );
};

/**
 * LIST API — PAGINATION CONTRACT (Phase 4)
 * ----------------------------------------
 * Canonical ordering everywhere: receivedAt DESC, _id DESC (deterministic;
 * _id breaks identical-timestamp ties so page boundaries are stable).
 *
 * NEW contract (cursor/keyset, used by the current client):
 *   GET /api/emails?folder=X&limit=50[&cursor=BASE64][&search=S]
 *   → 200 {
 *       emails: [...],
 *       pagination: { hasMore: bool, nextCursor: string|null, total: number|null }
 *     }
 *   - nextCursor is present iff hasMore; pass it back as ?cursor for the next page.
 *   - total is computed ONLY on first-page requests (no cursor param) and is
 *     cached with the payload — later pages omit it and clients keep the
 *     last known value.
 *   - Malformed cursor → 400 { message: "Invalid cursor" }.
 *   - limit is clamped to [1, 200]; invalid values normalize to 50.
 *
 * LEGACY contract (deploy-order safety only — old deployed clients send
 * offset/page and read totalCount; kept byte-compatible):
 *   GET /api/emails?...&offset=N|page=P → { source, emails, totalCount }
 *
 * Filter semantics (Phase 2 contract, unchanged): folder ∈ special folders ∪
 * canonical categories; unknown folder → 400; search NARROWS via $and with
 * escaped regex; cache bypassed while searching.
 */
const getEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    const search = req.query.search;

    // limit: non-numeric or <1 → default 50; hard cap 200
    let limit = parseInt(req.query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    const folderQuery = buildFolderQuery(req.query.folder);
    if (!folderQuery) {
      return res.status(400).json({ message: `Unknown folder: ${req.query.folder}` });
    }

    const query = {
      userId,
      ...folderQuery,
    };
    if (!folderQuery.isDeleted) {
      query.isDeleted = false;
    }

    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$and = [
        {
          $or: [
            { subject: { $regex: escaped, $options: "i" } },
            { from: { $regex: escaped, $options: "i" } },
            { snippet: { $regex: escaped, $options: "i" } },
          ],
        },
      ];
    }

    const sort = { receivedAt: -1, _id: -1 }; // deterministic tie-breaking

    // ── LEGACY MODE: old clients page by offset/page ────────────────────────
    const isLegacy =
      req.query.offset !== undefined || req.query.page !== undefined;

    if (isLegacy) {
      let skip = 0;
      if (req.query.offset !== undefined) {
        skip = parseInt(req.query.offset);
        if (!Number.isFinite(skip) || skip < 0) skip = 0;
      } else {
        const page = parseInt(req.query.page) || 1;
        skip = (page - 1) * limit;
      }

      const cacheKey = `user:${userId}:folder:${req.query.folder || "inbox"}:skip:${skip}:limit:${limit}`;
      if (!search) {
        const cached = await redisClient.get(cacheKey);
        if (cached) return res.json({ source: "cache", ...JSON.parse(cached) });
      }

      const [emails, totalCount] = await Promise.all([
        Email.find(query).sort(sort).skip(skip).limit(limit)
          .select(LIST_PROJECTION).lean(),
        Email.countDocuments(query),
      ]);

      const responseData = { emails, totalCount };
      if (!search) {
        await redisClient.set(cacheKey, JSON.stringify(responseData), "EX", 900);
      }
      return res.json({ source: "db", ...responseData });
    }

    // ── CURSOR MODE (current client) ─────────────────────────────────────────
    let cursor = null;
    if (req.query.cursor !== undefined && req.query.cursor !== "") {
      cursor = decodeCursor(req.query.cursor);
      if (!cursor) {
        return res.status(400).json({ message: "Invalid cursor" });
      }
    }
    const isFirstPage = !cursor;

    Object.assign(query, keysetBoundary(cursor));

    const cacheKey = `user:${userId}:folder:${req.query.folder || "inbox"}:c:${req.query.cursor || "first"}:l:${limit}`;
    if (!search) {
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }

    // limit+1 probe → hasMore without any count query
    const rows = await Email.find(query).sort(sort)
      .limit(limit + 1)
      .select(LIST_PROJECTION).lean();

    const hasMore = rows.length > limit;
    const emails = hasMore ? rows.slice(0, limit) : rows;

    const lastRow = emails[emails.length - 1];
    const nextCursor = hasMore && lastRow
      ? encodeCursor(lastRow.receivedAt, lastRow._id)
      : null;

    let total = null;
    if (isFirstPage) {
      // Count only when a fresh first page is built (cached thereafter).
      total = await Email.countDocuments(query);
    }

    const responseData = {
      emails,
      pagination: { hasMore, nextCursor, total },
    };

    if (!search) {
      await redisClient.set(cacheKey, JSON.stringify(responseData), "EX", 900);
    }

    return res.json(responseData);
  } catch (err) {
    req.log.error({ stack: err.stack }, "getEmails failed: " + err.message);
    return res.status(500).json({ message: "Failed to list emails" });
  }
};

const getEmailById = async (req, res) => {
  try {
    const email = await Email.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isDeleted: false,
    });

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    return res.json(email);
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    req.log.error({ stack: err.stack }, "getEmailById failed: " + err.message);
    return res.status(500).json({ message: "Failed to load email" });
  }
};

/**
 * PATCH /api/emails/:id
 * Allowed: isRead, isStarred, category.
 * Setting `category` marks the email userOverride=true AND records a
 * sender-domain preference so future syncs classify that sender correctly.
 */
const updateEmail = async (req, res) => {
  try {
    const allowedFields = ["isRead", "isStarred", "category"];
    const update = {};

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = req.body[key];
      }
    }

    if (update.category !== undefined) {
      if (!isValidCategory(update.category)) {
        return res.status(400).json({ message: `Invalid category: ${update.category}` });
      }
      // A manual move always wins over future automatic classification
      update.userOverride = true;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No valid fields provided" });
    }

    const email = await Email.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isDeleted: false,
      },
      update,
      { returnDocument: "after", runValidators: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // Learn: sender domain → chosen category
    if (update.category) {
      const domain = extractSenderDomain(email.from);
      if (domain) {
        await CategoryPreference.updateOne(
          { userId: req.user.id, senderDomain: domain },
          { category: update.category },
          { upsert: true }
        );
      }
    }

    await bustFolderCache(req.user.id);

    return res.json({
      _id: email._id,
      isRead: email.isRead,
      isStarred: email.isStarred,
      category: email.category,
      userOverride: email.userOverride,
    });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    req.log.error({ stack: err.stack }, "updateEmail failed: " + err.message);
    return res.status(500).json({ message: "Failed to update email" });
  }
};

const deleteEmail = async (req, res) => {
  try {
    // Get ORIGINAL document by omitting returnDocument (defaults to before)
    const email = await Email.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isDeleted: false,
      },
      { isDeleted: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    const snapshot = { restoreNotDeletedIds: [email._id.toString()] }; // Since query guarantees isDeleted: false
    await enqueueActionJob(req.user.id, email._id, email.gmailMessageId, "delete", snapshot);

    await bustFolderCache(req.user.id);

    return res.json({ message: "Email deletion queued" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    req.log.error({ stack: err.stack }, "deleteEmail failed: " + err.message);
    return res.status(500).json({ message: "Failed to delete email" });
  }
};

const archiveEmail = async (req, res) => {
  try {
    // Get ORIGINAL document by omitting returnDocument (defaults to before)
    const email = await Email.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isDeleted: false,
      },
      { $pull: { labels: "INBOX" } }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    const snapshot = {
      restoreInboxIds: email.labels?.includes("INBOX") ? [email._id.toString()] : []
    };
    await enqueueActionJob(req.user.id, email._id, email.gmailMessageId, "archive", snapshot);

    await bustFolderCache(req.user.id);

    return res.json({ message: "Email archival queued" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    req.log.error({ stack: err.stack }, "archiveEmail failed: " + err.message);
    return res.status(500).json({ message: "Failed to archive email" });
  }
};

/**
 * Undo the IMMEDIATE local mutation applied when an action was queued.
 * Without this, a cancelled delete/archive would leave the email hidden
 * locally forever (unchanged messages are never re-synced by Gmail history).
 * Uses the shared resolver so legacy (Phase 2) job payloads also revert.
 */
const revertLocalAction = async (userId, action, jobData) => {
  const { archiveIds, notDeletedIds } = resolveRollbackIds(jobData);

  if (archiveIds.length) {
    await Email.updateMany(
      { _id: { $in: archiveIds }, userId },
      { $addToSet: { labels: "INBOX" } }
    );
  }
  if (notDeletedIds.length) {
    await Email.updateMany(
      { _id: { $in: notDeletedIds }, userId },
      { isDeleted: false }
    );
  }
};

const cancelAction = async (req, res) => {
  try {
    const jobId = `action:${req.user.id}:${req.params.id}`;

    const { actionQueue } = require("../queues/actionQueue");
    const job = await actionQueue.getJob(jobId);

    if (!job) {
      return res.status(409).json({ message: "Too late — the action has already completed." });
    }

    const state = await job.getState();
    if (state !== 'delayed' && state !== 'waiting') {
      return res.status(409).json({ message: "Too late — the action has already completed." });
    }

    await job.remove();

    // Revert the optimistic local change so the email reappears
    await revertLocalAction(req.user.id, job.data.action, job.data);
    await bustFolderCache(req.user.id);
    req.log?.info({ jobId }, "Cancelled queued action");

    return res.json({ message: "Action cancelled" });
  } catch (err) {
    req.log.error({ stack: err.stack }, "cancelAction failed: " + err.message);
    return res.status(500).json({ message: "Failed to cancel action" });
  }
};

const bulkCancelAction = async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ message: "jobId required" });

    const { actionQueue } = require("../queues/actionQueue");
    const job = await actionQueue.getJob(jobId);

    if (!job) {
      return res.status(409).json({ message: "Too late — the action has already completed." });
    }

    const state = await job.getState();
    if (state !== 'delayed' && state !== 'waiting') {
      return res.status(409).json({ message: "Too late — the action has already completed." });
    }

    await job.remove();

    // Revert the optimistic local changes for every email in the bulk action
    await revertLocalAction(req.user.id, job.data.action, job.data);
    await bustFolderCache(req.user.id);
    req.log?.info({ jobId }, "Cancelled queued action");

    return res.json({ message: "Bulk action cancelled" });
  } catch (err) {
    req.log.error({ stack: err.stack }, "bulkCancelAction failed: " + err.message);
    return res.status(500).json({ message: "Failed to cancel bulk action" });
  }
};

const MAX_BULK_IDS = 100;

const bulkArchiveEmails = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Invalid ids" });
    if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Too many ids (max ${MAX_BULK_IDS})` });

    const emails = await Email.find(
      { _id: { $in: ids }, userId: req.user.id, isDeleted: false },
      { _id: 1, gmailMessageId: 1, labels: 1 }
    ).lean();
    if (!emails.length) return res.status(404).json({ message: "No matching emails found" });

    // Capture snapshot of those that actually had INBOX
    const restoreInboxIds = emails
      .filter(e => e.labels?.includes("INBOX"))
      .map(e => e._id.toString());

    // IMMEDIATE local persistence…
    await Email.updateMany(
      { _id: { $in: emails.map(e => e._id) } },
      { $pull: { labels: "INBOX" } }
    );

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    const validGmailIds = emails.map(e => e.gmailMessageId);
    
    const jobId = `bulk-${Date.now()}`;
    await enqueueActionJob(req.user.id, jobId, validGmailIds, "bulk-archive", { restoreInboxIds });

    await bustFolderCache(req.user.id);

    return res.json({ message: "Bulk archive queued", count: emails.length, jobId: `action:${req.user.id}:${jobId}` });
  } catch (err) {
    req.log.error({ stack: err.stack }, "bulkArchiveEmails failed: " + err.message);
    return res.status(500).json({ message: "Failed to bulk archive" });
  }
};

const bulkDeleteEmails = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Invalid ids" });
    if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Too many ids (max ${MAX_BULK_IDS})` });

    const emails = await Email.find(
      { _id: { $in: ids }, userId: req.user.id, isDeleted: false },
      { _id: 1, gmailMessageId: 1 }
    ).lean();
    if (!emails.length) return res.status(404).json({ message: "No matching emails found" });

    // Since the query guarantees isDeleted: false, all found ids are valid for restore
    const restoreNotDeletedIds = emails.map(e => e._id.toString());

    // IMMEDIATE local persistence…
    await Email.updateMany(
      { _id: { $in: emails.map(e => e._id) } },
      { isDeleted: true }
    );

    // …then propagate to Gmail asynchronously (TRASH, same as single delete).
    const { enqueueActionJob } = require("../queues/actionQueue");
    const validGmailIds = emails.map(e => e.gmailMessageId);
    
    const jobId = `bulk-${Date.now()}`;
    await enqueueActionJob(req.user.id, jobId, validGmailIds, "bulk-trash", { restoreNotDeletedIds });

    await bustFolderCache(req.user.id);

    return res.json({ message: "Bulk delete queued", count: emails.length, jobId: `action:${req.user.id}:${jobId}` });
  } catch (err) {
    req.log.error({ stack: err.stack }, "bulkDeleteEmails failed: " + err.message);
    return res.status(500).json({ message: "Failed to bulk delete" });
  }
};

module.exports = {
  getEmails,
  getEmailById,
  updateEmail,
  deleteEmail,
  archiveEmail,
  cancelAction,
  bulkArchiveEmails,
  bulkDeleteEmails,
  bulkCancelAction
};
