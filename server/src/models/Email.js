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

    // Normalized sender domain, persisted at ingestion (Phase 11) to support
    // indexed contextual-history lookups without regexing the raw From header.
    senderDomain: String,
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

    // Phase 8 provenance: which layer produced the current category.
    // "user" (manual move) | "rule" | "gmail_tab" | "preference" |
    // "default" | "error_fallback". Legacy docs read "unknown".
    classificationSource: {
      type: String,
      enum: [
        "unknown", "user", "preference", "rule",
        "gmail_tab", "default", "error_fallback", "ai", "context",
      ],
      default: "unknown",
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

// ✅ UNIQUE per user (VERY IMPORTANT)
emailSchema.index(
  { userId: 1, gmailMessageId: 1 },
  { unique: true }
);

// ✅ BASE ORDERING — archive / trash / unread / search / pinned views and
//    keyset seeks that lack a covering equality field. Multikey `labels`
//    queries fall back to this when labels isn't the leading bound.
emailSchema.index({ userId: 1, receivedAt: -1 });

// ✅ FAST FOLDER (CATEGORY) QUERIES
emailSchema.index({ userId: 1, category: 1, receivedAt: -1 });

// ✅ FAST INBOX / UNREAD — equality on a labels element + sort order.
//    Multikey index: matches any doc whose labels array contains the value.
//    Covers the default inbox view ({userId, isDeleted:false, labels:"INBOX"})
//    which previously residual-filtered over the entire mailbox.
emailSchema.index({ userId: 1, labels: 1, receivedAt: -1 });

// ✅ PHASE 11 CONTEXT LOOKUPS — bounded per-key history for uncertain emails:
//    {userId, senderDomain} equality + receivedAt sort (domain context)
//    {userId, threadId}     equality + receivedAt sort (thread context)
//    Both queries are proven shapes from services/contextResolver.js; without
//    these indexes each lookup would residual-scan the user's mailbox.
emailSchema.index({ userId: 1, senderDomain: 1, receivedAt: -1 });
emailSchema.index({ userId: 1, threadId: 1, receivedAt: -1 });
// NOTE (Phase 4 audit): the former {subject:"text", from:"text"} index was
// removed — no query ever used $text; it only added write amplification.
// Run scripts/migrate-email-indexes.js once to drop it on existing databases.

module.exports = mongoose.model("Email", emailSchema);
