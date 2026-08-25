const mongoose = require("mongoose");

/**
 * Per-user learned classification preferences.
 *
 * When a user moves an email to a different category (PATCH with `category`),
 * we record senderDomain → category. Future syncs consult this map BEFORE
 * the rule engine, so the user's correction silently applies to all mail
 * from that sender.
 */
const categoryPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderDomain: { type: String, required: true, lowercase: true, trim: true },
    category: { type: String, required: true },
  },
  { timestamps: true }
);

categoryPreferenceSchema.index(
  { userId: 1, senderDomain: 1 },
  { unique: true }
);

module.exports = mongoose.model("CategoryPreference", categoryPreferenceSchema);
