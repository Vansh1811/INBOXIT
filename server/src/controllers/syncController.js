const { enqueueSyncJob } = require("../queues/syncQueue");
const User = require("../models/User");

const syncEmails = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const type = "incremental";
    // ✅ use centralized enqueue (no direct queue.add)
    await enqueueSyncJob(userId, type);

    res.json({ message: `Sync job queued (${type})`, type });
  } catch (err) {
    console.error("Sync controller error:", err.message);
    res.status(500).json({ message: "Failed to queue sync job" });
  }
};

module.exports = { syncEmails };