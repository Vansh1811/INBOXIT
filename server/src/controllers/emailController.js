const Email = require("../models/Email");
const { redisClient } = require("../config/redis");
const { getGmailClient } = require("../utils/gmailClient");

const getEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    const folder = req.query.folder || "uncategorized";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const cacheKey = `user:${userId}:folder:${folder}:page:${page}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json({ source: "cache", emails: JSON.parse(cached) });
    }

    const emails = await Email.find({
      userId,
      category: folder,
      isDeleted: false,
    })
      .sort({ receivedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("from subject snippet receivedAt isRead isStarred category");

    await redisClient.set(cacheKey, JSON.stringify(emails), "EX", 900);

    res.json({ source: "db", emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    return res.status(500).json({ error: err.message });
  }
};

const updateEmail = async (req, res) => {
  try {
    const allowedFields = ["isRead", "isStarred", "category", "userOverride", "labels"];
    const update = {};

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = req.body[key];
      }
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

    return res.json(email);
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
      { isDeleted: true },
      { new: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // 🔥 Trash in actual Gmail
    try {
      const gmail = await getGmailClient(req.user.id);
      await gmail.users.messages.trash({
        userId: "me",
        id: email.gmailMessageId,
      });
    } catch (gmailErr) {
      console.warn("[Gmail] Trash failed:", gmailErr.message);
    }

    return res.json({ message: "Email deleted" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
      { $addToSet: { labels: "ARCHIVED" } },
      { new: true }
    );

    if (!email) {
      return res.status(404).json({ message: "Email not found" });
    }

    // 🔥 Archive in actual Gmail (remove INBOX label)
    try {
      const gmail = await getGmailClient(req.user.id);
      await gmail.users.messages.modify({
        userId: "me",
        id: email.gmailMessageId,
        requestBody: {
          removeLabelIds: ["INBOX"],
        },
      });
    } catch (gmailErr) {
      console.warn("[Gmail] Archive failed:", gmailErr.message);
    }

    return res.json({ message: "Email archived", email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getEmails,
  getEmailById,
  updateEmail,
  deleteEmail,
  archiveEmail,
};
