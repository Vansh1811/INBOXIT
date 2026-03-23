const mongoose = require("mongoose");

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

    // ✅ NEW (multi-category)
    categories: {
      type: [String],
      default: ["uncategorized"],
      index: true,
    },

    isRead: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    userOverride: { type: Boolean, default: false },

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

module.exports = mongoose.model("Email", emailSchema);