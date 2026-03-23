const User = require("../models/User");
const Email = require("../models/Email");
const { redisClient } = require("../config/redis");
const { getGmailClient } = require("../utils/gmailClient");

const getEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    const folder = req.query.folder || "inbox"; 
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search;
    
    // 🔴 THE SHIFT: Check for exact offset, fallback to page for safety
    let skip = 0;
    if (req.query.offset !== undefined) {
      skip = parseInt(req.query.offset);
    } else {
      const page = parseInt(req.query.page) || 1;
      skip = (page - 1) * limit;
    }

    // Cache key now uses 'skip' instead of 'page'
    const cacheKey = `user:${userId}:folder:${folder}:skip:${skip}`;

    if (!search) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ source: "cache", ...JSON.parse(cached) });
      }
    }

    // Base query: Must belong to user and not be in the trash
    const query = {
      userId,
      isDeleted: false,
    };

    if (folder === "inbox") {
      query.labels = { $ne: "ARCHIVED" }; 
    } else {
      query.$or = [
        { category: folder.toLowerCase() },
        { categories: { $in: [folder.toLowerCase()] } }
      ];
    }

    if (search) {
      query.$or = [
        { subject: { $regex: search, $options: "i" } },
        { from: { $regex: search, $options: "i" } },
        { snippet: { $regex: search, $options: "i" } },
      ];
    }

    const [emails, totalCount] = await Promise.all([
      Email.find(query)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("from subject snippet receivedAt isRead isStarred category categories labels")
        .lean(),
      Email.countDocuments(query)
    ]);

    const responseData = { emails, totalCount };

    if (!search) {
      await redisClient.set(cacheKey, JSON.stringify(responseData), "EX", 900);
    }

    return res.json({ source: "db", ...responseData });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

    const keys = await redisClient.keys(`user:${req.user.id}:folder:*`);
    if (keys.length) await redisClient.del(keys);

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

    const keys = await redisClient.keys(`user:${req.user.id}:folder:*`);
    if (keys.length) await redisClient.del(keys);

    try {
      const user = await User.findById(req.user.id);
      const gmail = await getGmailClient(user);
      await gmail.users.messages.trash({
        userId: "me",
        id: email.gmailMessageId,
      });
      console.log("[Gmail] Trashed:", email.gmailMessageId);
    } catch (gmailErr) {
      console.error("[Gmail] Trash failed:", gmailErr.message);
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

    const keys = await redisClient.keys(`user:${req.user.id}:folder:*`);
    if (keys.length) await redisClient.del(keys);

    try {
      const user = await User.findById(req.user.id);
      const gmail = await getGmailClient(user);
      await gmail.users.messages.modify({
        userId: "me",
        id: email.gmailMessageId,
        requestBody: { removeLabelIds: ["INBOX"] },
      });
    } catch (gmailErr) {
      console.error("[Gmail] Archive failed:", gmailErr.message);
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