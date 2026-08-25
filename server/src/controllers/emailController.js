const Email = require("../models/Email");
const CategoryPreference = require("../models/CategoryPreference");
const { redisClient } = require("../config/redis");
const { isValidCategory, extractSenderDomain } = require("../services/categories");

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

/** Invalidate all cached folder listings for this user. */
const bustFolderCache = async (userId) => {
  const keys = await redisClient.keys(`user:${userId}:folder:*`);
  if (keys.length) await redisClient.del(keys);
};

const getEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const search = req.query.search;

    let skip = 0;
    if (req.query.offset !== undefined) {
      skip = parseInt(req.query.offset);
      if (!Number.isFinite(skip) || skip < 0) skip = 0;
    } else {
      const page = parseInt(req.query.page) || 1;
      skip = (page - 1) * limit;
    }

    const folderQuery = buildFolderQuery(req.query.folder);
    if (!folderQuery) {
      return res.status(400).json({ message: `Unknown folder: ${req.query.folder}` });
    }

    // Base query: belongs to user, not trashed (trash view flips this)
    const query = {
      userId,
      ...folderQuery,
    };

    // Trash view shows deleted mail; every other view hides it
    if (!folderQuery.isDeleted) {
      query.isDeleted = false;
    }

    // Search must NARROW the current folder, never replace it.
    // Folder conditions stay at the top level; search goes into $and.
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

    const cacheKey = `user:${userId}:folder:${req.query.folder || "inbox"}:skip:${skip}:limit:${limit}`;

    if (!search) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ source: "cache", ...JSON.parse(cached) });
      }
    }

    const [emails, totalCount] = await Promise.all([
      Email.find(query)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("from subject snippet receivedAt isRead isStarred category userOverride labels")
        .lean(),
      Email.countDocuments(query)
    ]);

    const responseData = { emails, totalCount };

    if (!search) {
      await redisClient.set(cacheKey, JSON.stringify(responseData), "EX", 900);
    }

    return res.json({ source: "db", ...responseData });
  } catch (err) {
    console.error("[getEmails]", err.message);
    return res.status(500).json({ error: "Failed to list emails" });
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
    console.error("[getEmailById]", err.message);
    return res.status(500).json({ error: "Failed to load email" });
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
      { new: true, runValidators: true }
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
    console.error("[updateEmail]", err.message);
    return res.status(500).json({ error: "Failed to update email" });
  }
};

const deleteEmail = async (req, res) => {
  try {
    const email = await Email.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isDeleted: false,
      },
      { isDeleted: true }, // IMMEDIATE local persistence…
      { new: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    await enqueueActionJob(req.user.id, email._id, email.gmailMessageId, "delete");

    await bustFolderCache(req.user.id);

    return res.json({ message: "Email deletion queued" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    console.error("[deleteEmail]", err.message);
    return res.status(500).json({ error: "Failed to delete email" });
  }
};

const archiveEmail = async (req, res) => {
  try {
    const email = await Email.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isDeleted: false,
      },
      { $pull: { labels: "INBOX" } }, // IMMEDIATE local persistence…
      { new: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    await enqueueActionJob(req.user.id, email._id, email.gmailMessageId, "archive");

    await bustFolderCache(req.user.id);

    return res.json({ message: "Email archival queued" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ message: "Email not found" });
    }
    console.error("[archiveEmail]", err.message);
    return res.status(500).json({ error: "Failed to archive email" });
  }
};

/**
 * Undo the IMMEDIATE local mutation applied when an action was queued.
 * Without this, a cancelled delete/archive would leave the email hidden
 * locally forever (unchanged messages are never re-synced by Gmail history).
 */
const revertLocalAction = async (userId, action, mongoIds) => {
  const filter = { _id: { $in: mongoIds }, userId };
  if (action === "delete") {
    await Email.updateMany(filter, { isDeleted: false });
  } else if (action === "archive") {
    await Email.updateMany(filter, { $addToSet: { labels: "INBOX" } });
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
    await revertLocalAction(req.user.id, job.data.action, [req.params.id]);
    await bustFolderCache(req.user.id);
    console.log(`[Queue] Cancelled job ${jobId}`);

    return res.json({ message: "Action cancelled" });
  } catch (err) {
    console.error("[cancelAction]", err.message);
    return res.status(500).json({ error: "Failed to cancel action" });
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
    const mongoIds = Array.isArray(job.data.mongoIds) ? job.data.mongoIds : [];
    if (mongoIds.length) {
      await revertLocalAction(req.user.id, job.data.action, mongoIds);
      await bustFolderCache(req.user.id);
    }
    console.log(`[Queue] Cancelled job ${jobId}`);

    return res.json({ message: "Bulk action cancelled" });
  } catch (err) {
    console.error("[bulkCancelAction]", err.message);
    return res.status(500).json({ error: "Failed to cancel bulk action" });
  }
};

const MAX_BULK_IDS = 100;

const bulkArchiveEmails = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Invalid ids" });
    if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Too many ids (max ${MAX_BULK_IDS})` });

    // IMMEDIATE local persistence…
    const result = await Email.updateMany(
      { _id: { $in: ids }, userId: req.user.id, isDeleted: false },
      { $pull: { labels: "INBOX" } }
    );
    if (!result.matchedCount) return res.status(404).json({ message: "No matching emails found" });

    const emails = await Email.find(
      { _id: { $in: ids }, userId: req.user.id, isDeleted: false },
      { _id: 1, gmailMessageId: 1 }
    ).lean();

    // …then propagate to Gmail asynchronously.
    const { enqueueActionJob } = require("../queues/actionQueue");
    const validGmailIds = emails.map(e => e.gmailMessageId);
    const validMongoIds = emails.map(e => e._id.toString());

    const jobId = `bulk-${Date.now()}`;
    await enqueueActionJob(req.user.id, jobId, validGmailIds, "bulk-archive", validMongoIds);

    await bustFolderCache(req.user.id);

    return res.json({ message: "Bulk archive queued", count: emails.length, jobId: `action:${req.user.id}:${jobId}` });
  } catch (err) {
    console.error("[bulkArchiveEmails]", err.message);
    return res.status(500).json({ error: "Failed to bulk archive" });
  }
};

const bulkDeleteEmails = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Invalid ids" });
    if (ids.length > MAX_BULK_IDS) return res.status(400).json({ message: `Too many ids (max ${MAX_BULK_IDS})` });

    // IMMEDIATE local persistence…
    const result = await Email.updateMany(
      { _id: { $in: ids }, userId: req.user.id, isDeleted: false },
      { isDeleted: true }
    );
    if (!result.matchedCount) return res.status(404).json({ message: "No matching emails found" });

    const emails = await Email.find(
      { _id: { $in: ids }, userId: req.user.id },
      { _id: 1, gmailMessageId: 1 }
    ).lean();

    // …then propagate to Gmail asynchronously (TRASH, same as single delete).
    const { enqueueActionJob } = require("../queues/actionQueue");
    const validGmailIds = emails.map(e => e.gmailMessageId);
    const validMongoIds = emails.map(e => e._id.toString());

    const jobId = `bulk-${Date.now()}`;
    await enqueueActionJob(req.user.id, jobId, validGmailIds, "bulk-trash", validMongoIds);

    await bustFolderCache(req.user.id);

    return res.json({ message: "Bulk delete queued", count: emails.length, jobId: `action:${req.user.id}:${jobId}` });
  } catch (err) {
    console.error("[bulkDeleteEmails]", err.message);
    return res.status(500).json({ error: "Failed to bulk delete" });
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
