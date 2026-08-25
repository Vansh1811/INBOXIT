const mongoose = require("mongoose");
const { CATEGORIES } = require("../services/categories");

const emailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    gmailMessageId: {
      type: String,
      required: true
    },

    threadId: String,
    from: String,
    to: String,
    subject: String,
    snippet: String,
    bodyHtml: String,
    bodyText: String,

    receivedAt: { type: Date, index: true },

    // CANONICAL single category (see services/categories.js).
    // Replaces the former multi-value `categories` array.
    category: {
      type: String,
      enum: CATEGORIES,
      default: "uncategorized",
    },

    // True once the user manually assigns a category; the sync pipeline
    // never overwrites the category of an overridden email.
    userOverride: { type: Boolean, default: false },

    isRead: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },

    labels: [String],
  },
  { timestamps: true }
);

// ✅ TEXT SEARCH
emailSchema.index({ subject: "text", from: "text" });

// ✅ UNIQUE per user (VERY IMPORTANT)
emailSchema.index(
  { userId: 1, gmailMessageId: 1 },
  { unique: true }
);

// ✅ FAST INBOX QUERIES
emailSchema.index({ userId: 1, receivedAt: -1 });

// ✅ FAST FOLDER (CATEGORY) QUERIES
emailSchema.index({ userId: 1, category: 1, receivedAt: -1 });

module.exports = mongoose.model("Email", emailSchema);
