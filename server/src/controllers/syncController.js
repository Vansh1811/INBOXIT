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
    await enqueueSyncJob(userId, type);

    res.json({ message: `Sync job queued (${type})`, type });
  } catch (err) {
    console.error("Sync controller error:", err.message);
    res.status(500).json({ message: "Failed to queue sync job" });
  }
};


const loadMoreEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // We don't care if a token exists or not. We FORCE the historical job to queue.
    const type = "historical"; 
    await enqueueSyncJob(userId, type);

    // This is the message you SHOULD see in Postman!
    res.json({ message: "Deep historical sync enqueued successfully!", type });
  } catch (err) {
    console.error("Load more controller error:", err.message);
    res.status(500).json({ message: "Failed to queue load-more job" });
  }
};

module.exports = { syncEmails, loadMoreEmails };