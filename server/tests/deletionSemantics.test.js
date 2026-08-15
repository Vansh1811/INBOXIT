require("dotenv").config();
const mongoose = require("mongoose");
const assert = require("assert");

const path = require("path");

// Mock axios
const axiosPath = require.resolve("axios");
require(axiosPath);
require.cache[axiosPath].exports = {
  post: async () => ({ data: { access_token: "mock-new-token", expires_in: 3600 } }),
  get: require(axiosPath).get // Keep others intact if needed
};

// Setup require cache override for getGmailClient
const gmailClientPath = require.resolve("../src/utils/gmailClient");
require(gmailClientPath);
require.cache[gmailClientPath].exports = {
  getGmailClient: () => global.mockGmail
};

const { runSync } = require("../src/services/emailSyncService");
const Email = require("../src/models/Email");
const User = require("../src/models/User");

async function runTests() {
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/inboxit";
  await mongoose.connect(MONGO_URI);
  
  await User.deleteMany({ googleId: "123" });
  const user = new User({
    email: "test@example.com",
    name: "Test",
    googleId: "123",
    accessToken: "mock",
    refreshToken: "mock",
    tokenExpiry: new Date(Date.now() + 100000),
    lastHistoryId: "1000",
    syncState: { totalSynced: 0 }
  });
  await user.save();
  const userId = user._id;

  try {
    console.log("Starting Deletion Semantics Tests...");

    // Seed existing emails in Mongo that we will test modifying/deleting
    await Email.insertMany([
      { userId, gmailMessageId: "msg-archived", subject: "Will Archive", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-trashed", subject: "Will Trash", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-deleted", subject: "Will Delete", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-race", subject: "Will Race Delete", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-mixed-archived", subject: "Mixed Archive", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-mixed-trashed", subject: "Mixed Trash", labels: ["INBOX"], isDeleted: false },
      { userId, gmailMessageId: "msg-mixed-deleted", subject: "Mixed Delete", labels: ["INBOX"], isDeleted: false },
    ]);

    // Mock Gmail Responses
    global.mockGmail = {
      users: {
        getProfile: async () => ({ data: { historyId: "2000" } }),
        history: {
          list: async ({ historyTypes }) => {
            // Assert that messageDeleted is requested
            assert.ok(historyTypes.includes("messageDeleted"), "must request messageDeleted");
            
            return {
              data: {
                history: [
                  // Test 1: Archive
                  { labelsRemoved: [{ message: { id: "msg-archived" } }] },
                  // Test 2: Trash
                  { labelsAdded: [{ message: { id: "msg-trashed" } }] },
                  // Test 3: Permanent Delete
                  { messagesDeleted: [{ message: { id: "msg-deleted" } }] },
                  // Test 4: Double-delete race (Trash then Delete)
                  { labelsAdded: [{ message: { id: "msg-race" } }], messagesDeleted: [{ message: { id: "msg-race" } }] },
                  // Test 5: Mixed batch (also new email msg-new)
                  { messagesAdded: [{ message: { id: "msg-new" } }] },
                  { labelsRemoved: [{ message: { id: "msg-mixed-archived" } }] },
                  { labelsAdded: [{ message: { id: "msg-mixed-trashed" } }] },
                  { messagesDeleted: [{ message: { id: "msg-mixed-deleted" } }] }
                ],
                nextPageToken: null
              }
            };
          }
        },
        messages: {
          get: async ({ id }) => {
            const mockEmails = {
              "msg-archived": { id: "msg-archived", labelIds: [], snippet: "archived", internalDate: "1", payload: { headers: [] } },
              "msg-trashed": { id: "msg-trashed", labelIds: ["TRASH"], snippet: "trashed", internalDate: "2", payload: { headers: [] } },
              "msg-new": { id: "msg-new", labelIds: ["INBOX"], snippet: "new", internalDate: "3", payload: { headers: [] } },
              "msg-mixed-archived": { id: "msg-mixed-archived", labelIds: [], snippet: "archived", internalDate: "4", payload: { headers: [] } },
              "msg-mixed-trashed": { id: "msg-mixed-trashed", labelIds: ["TRASH"], snippet: "trashed", internalDate: "5", payload: { headers: [] } },
            };

            if (["msg-deleted", "msg-race", "msg-mixed-deleted"].includes(id)) {
              const err = new Error("Not Found");
              err.response = { status: 404, data: { error: { message: "Not Found" } } };
              throw err;
            }

            return { data: mockEmails[id] };
          }
        }
      }
    };

    // Run Incremental Sync
    await runSync({ user, syncType: "incremental" });

    // VERIFICATIONS
    const remainingEmails = await Email.find({ userId }).sort({ gmailMessageId: 1 });
    const remainingIds = remainingEmails.map(e => e.gmailMessageId);

    // 1. Archive -> Remains in Mongo, no INBOX label
    assert.ok(remainingIds.includes("msg-archived"), "Archived email must remain in Mongo");
    const archivedEmail = remainingEmails.find(e => e.gmailMessageId === "msg-archived");
    assert.strictEqual(archivedEmail.labels.includes("INBOX"), false, "Archived email must not have INBOX label");

    // 2. Trash -> Remains in Mongo, has TRASH label
    assert.ok(remainingIds.includes("msg-trashed"), "Trashed email must remain in Mongo");
    const trashedEmail = remainingEmails.find(e => e.gmailMessageId === "msg-trashed");
    assert.ok(trashedEmail.labels.includes("TRASH"), "Trashed email must have TRASH label");
    assert.strictEqual(trashedEmail.labels.includes("INBOX"), false, "Trashed email must not have INBOX label");

    // 3. Permanent Delete -> Removed from Mongo
    assert.ok(!remainingIds.includes("msg-deleted"), "Permanently deleted email MUST be removed from Mongo");

    // 4. Double-delete race -> Removed from Mongo
    assert.ok(!remainingIds.includes("msg-race"), "Raced email MUST be removed from Mongo exactly once without crashing");

    // 5. Mixed batch
    assert.ok(remainingIds.includes("msg-new"), "New email MUST be inserted");
    assert.ok(remainingIds.includes("msg-mixed-archived"), "Mixed archived MUST remain");
    assert.ok(remainingIds.includes("msg-mixed-trashed"), "Mixed trashed MUST remain");
    assert.ok(!remainingIds.includes("msg-mixed-deleted"), "Mixed deleted MUST be removed");

    console.log("✅ All Deletion Semantics Tests Passed!");

  } catch (err) {
    console.error("❌ Test Failed:", err);
    process.exit(1);
  } finally {
    await Email.deleteMany({ userId });
    await User.deleteMany({ _id: userId });
    await mongoose.connection.close();
    process.exit(0);
  }
}

runTests();
