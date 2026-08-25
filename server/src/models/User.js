const mongoose = require("mongoose");
const { encryptToken, decryptToken } = require("../utils/tokenCrypto");

// OAuth tokens are encrypted at rest (AES-256-GCM) via schema-level
// setters/getters. All reads through normal (non-lean) queries return
// plaintext to application code; all writes are encrypted before hitting
// MongoDB. Legacy plaintext values pass through on read and are re-encrypted
// on their next write — no manual migration required.
const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, unique: true, required: true }, // sub from Google
    email: { type: String, required: true },
    name: String,
    avatar: String,

    accessToken: { type: String, set: encryptToken, get: decryptToken },
    refreshToken: { type: String, set: encryptToken, get: decryptToken },
    tokenExpiry: Date, // when accessToken expires

    lastHistoryId: String, // Gmail history cursor
    lastSyncedAt: Date,

    // 🔥 Chunked sync state
    syncState: {
      nextPageToken: { type: String, default: null },  // where to resume next chunk
      totalSynced:   { type: Number, default: 0 },     // running total synced
      isSyncing:     { type: Boolean, default: false }, // lock to prevent double sync
      syncStartedAt: { type: Date, default: null },    // when current sync started (auto-unlock after 10 min)
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);