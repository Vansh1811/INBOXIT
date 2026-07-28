const { getGmailClient } = require("../utils/gmailClient");
const { extractBody, extractHeaders } = require("../utils/mimeParser");
const { classify } = require("./classifier");
const Email = require("../models/Email");
const axios = require("axios");

const CHUNK_SIZE = 500;
const BATCH_SIZE = 10;

const processEmail = async (gmail, messageId, userId) => {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const msg = res.data;
  const { from, to, subject } = extractHeaders(msg.payload?.headers);
  const { bodyHtml, bodyText } = extractBody(msg.payload);
  
  // 1. Get your custom rule-based categories
  const customCategories = classify(from, subject);
  const categories = [...customCategories];
  
  // 2. Look at Gmail's native labels
  const gmailLabels = msg.labelIds || [];
  
  if (gmailLabels.includes("CATEGORY_PROMOTIONS")) categories.push("promotions");
  if (gmailLabels.includes("CATEGORY_SOCIAL")) categories.push("social");
  if (gmailLabels.includes("CATEGORY_UPDATES")) categories.push("updates");
  if (gmailLabels.includes("CATEGORY_FORUMS")) categories.push("forums");

  // 3. Remove duplicates
  let uniqueCategories = [...new Set(categories)];
  
  // 4. Cleanup: If we found a specific category, remove "uncategorized"
  if (uniqueCategories.length > 1) {
    uniqueCategories = uniqueCategories.filter(c => c !== "uncategorized");
  } 

  return {
    userId,
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    from,
    to,
    subject,
    snippet: msg.snippet,
    bodyHtml,
    bodyText,
    receivedAt: new Date(parseInt(msg.internalDate)),
    categories: uniqueCategories, 
    isRead:    !gmailLabels.includes("UNREAD"),
    isStarred:  gmailLabels.includes("STARRED") || false,
    labels:     gmailLabels,
  };
};

const fetchMessageChunk = async (gmail, pageToken = null, limit = CHUNK_SIZE) => {
  const allMessages = [];
  let currentPageToken = pageToken;

  while (allMessages.length < limit) {
    const batchSize = Math.min(100, limit - allMessages.length);

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: batchSize,
      labelIds: ["INBOX"],
      ...(currentPageToken && { pageToken: currentPageToken }),
    });

    const messages = res.data.messages || [];
    allMessages.push(...messages);
    currentPageToken = res.data.nextPageToken;

    if (!currentPageToken || messages.length === 0) break;
  }

  return {
    messages: allMessages,
    nextPageToken: currentPageToken || null,
  };
};

const fetchIncrementalMessageIds = async (gmail, startHistoryId) => {
  const changedIds = new Set();
  let pageToken;

  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      maxResults: 100,
      ...(pageToken && { pageToken }),
    });

    for (const record of res.data.history || []) {
      (record.messagesAdded || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsAdded   || []).forEach((m) => changedIds.add(m.message.id));
      (record.labelsRemoved || []).forEach((m) => changedIds.add(m.message.id));
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return [...changedIds].map((id) => ({ id }));
};

const getExistingMessageIds = async (userId, gmailIds) => {
  const existing = await Email.find(
    { userId, gmailMessageId: { $in: gmailIds } },
    { gmailMessageId: 1 }
  ).lean();
  return new Set(existing.map((e) => e.gmailMessageId));
};

const refreshTokenIfNeeded = async (user) => {
  const tokenExpiry = new Date(user.tokenExpiry).getTime();
  const buffer = 2 * 60 * 1000;

  if (tokenExpiry > Date.now() + buffer) return;

  console.log(`[EmailSyncService] ⚠️  Token expiring — refreshing...`);
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: user.refreshToken,
    grant_type:    "refresh_token",
  });

  user.accessToken = data.access_token;
  user.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);
  await user.save();
  console.log(`[EmailSyncService] ✅ Token refreshed`);
};

const getCurrentHistoryId = async (gmail) => {
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.historyId;
};

/**
 * Public API
 */
async function runSync({ user, syncType, onProgress, onEmailProcessed }) {
  const userId = user._id;

  try {
    await refreshTokenIfNeeded(user);
  } catch (err) {
    const customError = new Error("Token refresh failed. User needs to re-login.");
    customError.originalError = err;
    customError.isTokenError = true;
    throw customError;
  }

  const gmail = getGmailClient(user);

  let messages = [];
  let nextPageToken = user.syncState?.nextPageToken || null;
  let didFallback = false;

  const hasPendingPages = !!user.syncState?.nextPageToken;

  if (syncType === "incremental" && user.lastHistoryId) {
    console.log(`[EmailSyncService] Incremental sync (historyId=${user.lastHistoryId})...`);
    let incrementalMessages = [];

    try {
      incrementalMessages = await fetchIncrementalMessageIds(gmail, user.lastHistoryId);
      console.log(`[EmailSyncService] Incremental returned ${incrementalMessages.length} message(s)`);
    } catch (incErr) {
      const errMsg = incErr.response?.data?.error?.message || incErr.message;
      console.log(`[EmailSyncService] ⚠️  Incremental failed (${errMsg}) — falling back to chunk`);
      didFallback = true;
    }

    if (!didFallback) {
      messages = incrementalMessages;
    } else {
      console.log(`[EmailSyncService] Fallback chunk (resumeToken=${nextPageToken ? "saved" : "fresh"})...`);
      const result = await fetchMessageChunk(gmail, nextPageToken);
      messages = result.messages;
      nextPageToken = result.nextPageToken;
    }
  } else {
    console.log(`[EmailSyncService] Chunk sync (token=${nextPageToken ? "resume" : "fresh"})...`);
    const result = await fetchMessageChunk(gmail, nextPageToken);
    messages = result.messages;
    nextPageToken = result.nextPageToken;
  }

  console.log(`[EmailSyncService] ${messages.length} messages to process`);

  if (messages.length === 0) {
    console.log(`[EmailSyncService] ✅ Nothing to sync`);
    user.lastHistoryId = await getCurrentHistoryId(gmail);
    // The worker will save the user and handle lock release
    return {
      isEmpty: true,
      hasMore: !!nextPageToken,
      hasPendingPages,
      totalSynced: user.syncState.totalSynced || 0
    };
  }

  const allGmailIds = messages.map((m) => m.id);
  const isFull = syncType !== "incremental" || didFallback || hasPendingPages;
  const existingIds = isFull ? await getExistingMessageIds(userId, allGmailIds) : new Set();

  const newMessages = messages.filter((m) => !existingIds.has(m.id));
  const skipped = messages.length - newMessages.length;
  const total = newMessages.length;

  console.log(`[EmailSyncService] Skipping ${skipped} already-synced, processing ${total} new`);

  let saved = 0;
  let errors = 0;

  for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
    const batch = newMessages.slice(i, i + BATCH_SIZE);

    const parsedEmails = await Promise.all(
      batch.map(async ({ id }) => {
        try {
          return await processEmail(gmail, id, userId);
        } catch (err) {
          errors++;
          if (err?.response?.status === 404) {
             // deleted between list and get — skip silently
          } else {
             console.error(`[EmailSyncService] ❌ msg ${id}:`, err.response?.data?.error?.message || err.message);
          }
          return null; // Partial failure
        }
      })
    );

    const validEmails = parsedEmails.filter((e) => e !== null);

    if (validEmails.length > 0) {
      const bulkOps = validEmails.map((emailData) => ({
        updateOne: {
          filter: { userId, gmailMessageId: emailData.gmailMessageId },
          update: { $set: emailData },
          upsert: true,
        },
      }));

      await Email.bulkWrite(bulkOps);
      saved += validEmails.length;

      // Only fetch the full documents if we need to emit socket events for an incremental sync
      if (syncType === "incremental" && !didFallback && !hasPendingPages && onEmailProcessed) {
        const insertedEmails = await Email.find(
          { userId, gmailMessageId: { $in: validEmails.map((e) => e.gmailMessageId) } }
        ).lean();

        insertedEmails.forEach((email) => {
          onEmailProcessed({
            id: email._id,
            gmailMessageId: email.gmailMessageId,
            from: email.from,
            subject: email.subject,
            category: email.category, // frontend expects single category usually, but categories array exists too
            receivedAt: email.receivedAt,
          });
        });
      }
    }

    const processed = Math.min(i + BATCH_SIZE, newMessages.length);
    
    if (onProgress) {
      await onProgress(processed, total, saved, errors);
    }
    
    console.log(`[EmailSyncService] ${processed}/${total} (saved=${saved}, errors=${errors})`);
  }

  user.syncState.totalSynced = (user.syncState.totalSynced || 0) + saved;
  user.syncState.nextPageToken = nextPageToken;
  user.lastHistoryId = await getCurrentHistoryId(gmail);

  return {
    isEmpty: false,
    saved,
    skipped,
    errors,
    hasMore: !!nextPageToken,
    hasPendingPages,
    totalSynced: user.syncState.totalSynced
  };
}

module.exports = { runSync };
