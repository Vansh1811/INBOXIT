require("dotenv").config();
const mongoose = require("mongoose");
const Email = require("../src/models/Email");
const assert = require("assert");

async function runTests() {
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/inboxit";
  await mongoose.connect(MONGO_URI);
  
  const userId = new mongoose.Types.ObjectId();
  
  try {
    console.log("Starting Inbox Semantics Tests...");

    // Clean up before test
    await Email.deleteMany({ userId });

    // Seed test data
    const seedEmails = [
      {
        userId,
        gmailMessageId: "inbox-1",
        subject: "Inbox Email",
        labels: ["INBOX", "UNREAD"],
        isDeleted: false
      },
      {
        userId,
        gmailMessageId: "archived-1",
        subject: "Archived Email",
        labels: [], // No INBOX label
        isDeleted: false
      },
      {
        userId,
        gmailMessageId: "trashed-1",
        subject: "Trashed Email",
        labels: ["TRASH"], // No INBOX label
        isDeleted: false
      },
      {
        userId,
        gmailMessageId: "spam-1",
        subject: "Spam Email",
        labels: ["SPAM"], // No INBOX label
        isDeleted: false
      },
      {
        userId,
        gmailMessageId: "starred-inbox-1",
        subject: "Starred Inbox Email",
        labels: ["INBOX", "STARRED"],
        isDeleted: false
      },
      {
        userId,
        gmailMessageId: "starred-archived-1",
        subject: "Starred Archived Email",
        labels: ["STARRED"], // No INBOX label
        isDeleted: false
      }
    ];

    await Email.insertMany(seedEmails);

    // Run the old query (for comparison/demonstration, though we fixed it in code)
    const oldQuery = {
      userId,
      isDeleted: false,
      labels: { $ne: "ARCHIVED" } // How it used to be
    };

    const oldResults = await Email.find(oldQuery);
    console.log(`Old Query matched ${oldResults.length} emails (expected 1 or 2, but actually got all 6 because none have "ARCHIVED")`);
    assert.strictEqual(oldResults.length, 6, "Old query incorrectly matches everything");

    // Run the new query
    const newQuery = {
      userId,
      isDeleted: false,
      labels: "INBOX" // The correct Gmail semantic
    };

    const newResults = await Email.find(newQuery).sort({ gmailMessageId: 1 });
    console.log(`New Query matched ${newResults.length} emails (expected 2)`);
    assert.strictEqual(newResults.length, 2, "New query should exactly match 2 emails");

    const returnedIds = newResults.map(e => e.gmailMessageId);
    assert.ok(returnedIds.includes("inbox-1"), "Should include standard inbox email");
    assert.ok(returnedIds.includes("starred-inbox-1"), "Should include starred inbox email");

    console.log("✅ All Inbox Semantics Tests Passed!");

  } catch (err) {
    console.error("❌ Test Failed:", err);
    process.exit(1);
  } finally {
    await Email.deleteMany({ userId });
    await mongoose.connection.close();
    process.exit(0);
  }
}

runTests();
