const express = require("express");
const rateLimit = require("express-rate-limit");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");
const { enqueueSyncJob } = require("../queues/syncQueue");
const User = require("../models/User");

const router = express.Router();

// Sync jobs fan out into 500-email Gmail chunks — expensive by design.
// Cap how often each user can enqueue them.
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  message: { message: "Too many sync requests. Please wait before trying again." },
});

router.post("/", protect, refreshGmailToken, syncLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);

  // ✅ If already synced before, just do incremental — not full
  const type = user.lastHistoryId ? "incremental" : "full";

  await enqueueSyncJob(req.user.id.toString(), type);

  res.json({
    message: `Sync job queued (${type})`,
    hasMore: !!user.syncState?.nextPageToken,
    totalSynced: user.syncState?.totalSynced || 0,
  });
});

router.post("/load-more", protect, refreshGmailToken, syncLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);

  // 🔴 FIXED: Removed the nextPageToken blocker!
  // If the token is missing, the worker will self-heal by skipping 
  // existing emails and grabbing the next fresh batch.

  if (user.syncState?.isSyncing) {
    return res.status(429).json({ message: "Sync already in progress, please wait" });
  }

  // "full" tells your worker to skip the history API and just fetch chunks
  await enqueueSyncJob(req.user.id.toString(), "full");

  res.json({
    message: "Deep historical sync enqueued successfully!",
    hasMore: true,
    totalSynced: user.syncState?.totalSynced || 0,
  });
});

module.exports = router;