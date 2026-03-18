const { Worker } = require("bullmq");
const { redisClient } = require("../config/redis");
const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classify } = require("../services/classifier");
const User = require("../models/User");
const Email = require("../models/Email");

const bullConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
};

const processEmail = async (gmail, messageId, userId) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject, date } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);
  const category = classify(from, subject) || "uncategorized";

  await Email.findOneAndUpdate(
    { gmailMessageId: msg.id },
    {
      userId,
      gmailMessageId: msg.id,
      threadId: msg.threadId,
      from, to, subject,
      snippet: msg.snippet,
      bodyHtml, bodyText,
      receivedAt: new Date(parseInt(msg.internalDate)),
      category,
      isRead: !msg.labelIds?.includes("UNREAD"),
      isStarred: msg.labelIds?.includes("STARRED") || false,
      labels: msg.labelIds || [],
    },
    { upsert: true, new: true }
  );
};

// ─── Full sync: paginate through ALL emails using nextPageToken ───────────────
const fetchAllMessageIds = async (gmail) => {
  const allMessages = [];
  let pageToken = undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    const messages = res.data.messages || [];
    allMessages.push(...messages);
    pageToken = res.data.nextPageToken; // undefined when last page
  } while (pageToken);

  return allMessages;
};

// ─── Incremental sync: only fetch emails changed since lastHistoryId ──────────
const fetchIncrementalMessageIds = async (gmail, startHistoryId) => {
  const changedIds = new Set();
  let pageToken = undefined;

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    const history = res.data.history || [];
    for (const record of history) {
      (record.messages || []).forEach((m) => changedIds.add(m.id));
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return [...changedIds].map((id) => ({ id }));
};

const worker = new Worker(
  "gmail-sync",
  async (job) => {
    const { userId, type } = job.data;
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const gmail = getGmailClient(user);

    let messages = [];

    if (type === "incremental" && user.lastHistoryId) {
      // ✅ Only fetch new/changed emails since last sync
      console.log(`Incremental sync for ${user.email}, historyId: ${user.lastHistoryId}`);
      messages = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
    } else {
      // ✅ Full sync — paginate through ALL emails
      console.log(`Full sync for ${user.email} — fetching all pages...`);
      messages = await fetchAllMessageIds(gmail);
    }

    console.log(`Syncing ${messages.length} emails for ${user.email}`);

    for (const { id } of messages) {
      await processEmail(gmail, id, userId);
    }

    // Save latest historyId for next incremental sync
    const profile = await gmail.users.getProfile({ userId: "me" });
    user.lastHistoryId = profile.data.historyId;
    user.lastSyncedAt = new Date();
    await user.save();

    // Bust Redis cache for this user
    const keys = await redisClient.keys(`user:${userId}:*`);
    if (keys.length) await redisClient.del(keys);

    console.log(`Sync complete for ${user.email} ✅`);
  },
  { connection: bullConnection }
);

worker.on("failed", (job, err) => {
  console.error(`Sync job failed for ${job.data.userId}:`, err.message);
});

module.exports = worker;
