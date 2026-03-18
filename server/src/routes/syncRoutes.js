const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");
const { enqueueSyncJob } = require("../queues/syncQueue");
const User = require("../models/User");

const router = express.Router();

// Initial sync — called after OAuth or on app open
router.post("/", protect, refreshGmailToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const type = user.lastHistoryId ? "incremental" : "full";
  await enqueueSyncJob(req.user.id.toString(), type);
  res.json({
    message: `Sync job queued (${type})`,
    hasMore: !!user.syncState?.nextPageToken,
    totalSynced: user.syncState?.totalSynced || 0,
    note: type === "full"
      ? "First sync — fetching latest 3000 emails"
      : "Incremental sync — only new/changed emails",
  });
});

// 🔥 Load next 3000 emails — called when user scrolls / clicks "Load more"
router.post("/load-more", protect, refreshGmailToken, async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user.syncState?.nextPageToken) {
    return res.json({ message: "All emails already synced", hasMore: false });
  }

  if (user.syncState?.isSyncing) {
    return res.status(429).json({ message: "Sync already in progress, please wait" });
  }

  await enqueueSyncJob(req.user.id.toString(), "full"); // resumes from saved nextPageToken

  res.json({
    message: "Loading next chunk...",
    hasMore: true,
    totalSynced: user.syncState.totalSynced,
  });
});

module.exports = router;