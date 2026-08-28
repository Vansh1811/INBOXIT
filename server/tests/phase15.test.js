process.env.TOKEN_ENCRYPTION_KEY = Array.from({ length: 64 }, (_, i) => (i % 16).toString(16)).join("");
process.env.NODE_ENV = "test";
const { test, describe, mock } = require("node:test");
const assert = require("node:assert");

const { fetchIncrementalMessageIds } = require("../src/services/emailSyncService");
const { processJob } = require("../src/queues/syncWorker");
const User = require("../src/models/User");
const syncQueue = require("../src/queues/syncQueue");

describe("Phase 15 - Sync Correctness and Invariants (Actual Functions)", () => {

  test("BUG 2: Incremental sync captures historyId ONLY from the first page", async () => {
    let callCount = 0;
    const mockGmail = {
      users: {
        history: {
          list: async ({ pageToken }) => {
            callCount++;
            if (!pageToken) return { data: { historyId: "200", nextPageToken: "token1" } };
            return { data: { historyId: "300" } };
          }
        }
      }
    };

    const res = await fetchIncrementalMessageIds(mockGmail, "100");
    assert.strictEqual(res.historyId, "200", "Cursor MUST NOT advance to page 2's real-time historyId");
    assert.strictEqual(callCount, 2, "Should have fetched 2 pages");
  });

  test("BUG 3: Full sync continuation correctly retries on lock collision", async () => {
    // We mock User.findOneAndUpdate to simulate lock collision (returns null)
    const originalFindOneAndUpdate = User.findOneAndUpdate;
    mock.method(User, "findOneAndUpdate", async () => {
      return null; // Simulate lock collision: no user found with isSyncing: false
    });
    mock.method(User, "findById", () => {
      return { select: async () => ({ _id: "user123", syncState: { syncStartedAt: new Date() } }) };
    });

    try {
      const webhookJob = { data: { userId: "user123", type: "incremental" } };
      const webhookRes = await processJob(webhookJob);
      assert.strictEqual(webhookRes.skipped, true, "Incremental jobs should silently skip if locked");

      const fullJob = { data: { userId: "user123", type: "full" } };
      await assert.rejects(
        processJob(fullJob),
        /Lock collision during full sync continuation — retrying/,
        "Full continuation must throw to retry instead of silently aborting"
      );
    } finally {
      mock.restoreAll();
    }
  });

  test("BUG 1: Empty continuation chunk does NOT advance lastHistoryId", async () => {
    const { runSync } = require("../src/services/emailSyncService");
    
    mock.method(User, "updateOne", async () => { return { modifiedCount: 1 }; });
    // Mock the other methods that might be called
    const CategoryPreference = require("../src/models/CategoryPreference");
    if (CategoryPreference.find) {
      mock.method(CategoryPreference, "find", async () => []);
    }
    
    let getProfileCalled = false;
    const mockGmail = {
      users: {
        getProfile: async () => {
          getProfileCalled = true;
          return { data: { historyId: "999999" } };
        },
        history: {
          list: async () => ({ data: { historyId: "200" } })
        },
        messages: {
          list: async () => ({ data: { messages: [] } })
        }
      }
    };

    const user = {
      _id: "user123",
      syncState: { totalSynced: 0, nextPageToken: "token_from_last_time", erroredRuns: 0 },
      lastHistoryId: "111111",
      tokenExpiry: new Date(Date.now() + 10000000).toISOString()
    };

    // Replace the real google.gmail with a stub generator
    const { google } = require("googleapis");
    mock.method(google, "gmail", () => mockGmail);

    try {
      await runSync({ user, syncType: "full", jobId: "test-job-1" });
      
      assert.strictEqual(getProfileCalled, false, "MUST NOT fetch new cursor on continuation chunk");
      assert.strictEqual(user.lastHistoryId, "111111", "Cursor must remain at baseline during backfill");
    } finally {
      mock.restoreAll();
    }
  });

});

setTimeout(() => process.exit(0), 1000); // ensure it doesn't hang
