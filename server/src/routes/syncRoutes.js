const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");
const { enqueueSyncJob } = require("../queues/syncQueue"); 
const User = require("../models/User");

const router = express.Router();

router.post("/", protect, refreshGmailToken, async (req, res) => {
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

router.post("/load-more", protect, refreshGmailToken, async (req, res) => {
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