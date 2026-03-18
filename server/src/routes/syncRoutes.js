const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { refreshGmailToken } = require("../middleware/tokenRefreshMiddleware");
const { enqueueSyncJob } = require("../queues/syncQueue");

const router = express.Router();

router.post("/", protect, refreshGmailToken, async (req, res) => {
  await enqueueSyncJob(req.user._id.toString(), "full");
  res.json({ message: "Sync job queued ✅" });
});

module.exports = router;
