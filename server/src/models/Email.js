const mongoose = require("mongoose");

const emailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    gmailMessageId: { type: String, unique: true },
    threadId: String,

    from: String,
    to: String,
    subject: String,
    snippet: String,
    bodyHtml: String,  // capped at 100KB
    bodyText: String,  // capped at 100KB

    receivedAt: { type: Date, index: true },

    category: {
      type: String,
      enum: [
        "important", "personal", "newsletter", "promotion",
        "jobs", "food", "cabs", "finance", "health",
        "social", "todo", "uncategorized",
      ],
      default: "uncategorized",
    },

    isRead: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    userOverride: { type: Boolean, default: false }, // user manually set category

    labels: [String], // raw Gmail labels
  },
  { timestamps: true }
);

// text index for search (subject + from)
emailSchema.index({ subject: "text", from: "text" });

module.exports = mongoose.model("Email", emailSchema);
