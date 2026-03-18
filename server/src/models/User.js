const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, unique: true, required: true }, // sub from Google
    email: { type: String, required: true },
    name: String,
    avatar: String,

    accessToken: String,
    refreshToken: String,
    tokenExpiry: Date, // when accessToken expires

    lastHistoryId: String, // Gmail history cursor
    lastSyncedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
