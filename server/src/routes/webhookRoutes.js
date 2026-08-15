const express = require("express");
const User = require("../models/User");
const { enqueueSyncJob } = require("../queues/syncQueue");
const { getIO } = require("../config/socket");

const router = express.Router();

router.post("/gmail", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.data) {
      return res.status(400).send("Bad Request");
    }

    // Decode base64 data
    const decodedData = Buffer.from(message.data, "base64").toString("utf-8");
    const payload = JSON.parse(decodedData);
    const { emailAddress } = payload;

    if (!emailAddress) {
      return res.status(400).send("No email address in payload");
    }

    const user = await User.findOne({ email: emailAddress });
    if (!user) {
      return res.status(404).send("User not found");
    }

    const userId = user._id.toString();

    // Step 1: Emit sync:incoming BEFORE fetching the message
    const syncId = `push-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const io = getIO();
    if (io) {
      io.to(userId).emit("sync:incoming", {
        syncId,
        timestamp: Date.now(),
        userId
      });
    }

    // Queue incremental sync
    await enqueueSyncJob(userId, "incremental");

    res.status(200).send("OK");
  } catch (error) {
    console.error("[Webhook] Gmail push error:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
