const mongoose = require("mongoose");
const {
  applyFeedback,
  isActivePreference,
  activeCategoryOf,
} = require("../services/preferencePolicy");

/**
 * Per-user learned classification preferences (Phase 10 feedback model).
 *
 * Each document holds BOUNDED correction evidence for one (user, senderDomain):
 *   tallies  — corrections per canonical category, decayed/bounded by
 *              services/preferencePolicy.js
 *   total    — sum of tallies
 *   category — the most recent corrected category (informational)
 *
 * A preference is ACTIVE only when the evidence policy says so; inactive
 * records never influence classification. Users can always change their mind:
 * repeated contrary corrections decay the old preference and eventually
 * activate the new one.
 */
const categoryPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderDomain: { type: String, required: true, lowercase: true, trim: true },
    // Most recently requested category (informational; active category is
    // derived from `tallies` by the policy).
    category: { type: String, required: true },

    tallies: { type: Object, default: {} },
    total: { type: Number, default: 0 },
    lastFeedbackAt: { type: Date, default: null },
  },
  { timestamps: true }
);

categoryPreferenceSchema.index(
  { userId: 1, senderDomain: 1 },
  { unique: true }
);

/**
 * Centralized explicit-feedback recorder (O-Phase10 §4).
 *
 * The ONLY production path that mutates preference evidence. Deterministic:
 *   - applies the pure policy to produce the next bounded state
 *   - keeps `category` as "most recent correction" for explainability
 *
 * @returns {{previousActive: string|null, activeCategory: string|null,
 *            activated: boolean, reversed: boolean, totalEvidence: number}}
 */
categoryPreferenceSchema.statics.recordFeedback = async function (
  userId,
  senderDomain,
  category
) {
  const filter = { userId, senderDomain };
  let doc = await this.findOne(filter);

  const previousActive = doc && doc.tallies
    ? activeCategoryOf({ tallies: doc.tallies, total: doc.total })
    : null;

  const next = applyFeedback(
    doc ? { tallies: doc.tallies, total: doc.total } : {},
    category
  );

  if (!doc) {
    doc = new this({ userId, senderDomain, category });
  } else {
    doc.category = category;
  }
  doc.tallies = next.tallies;
  doc.total = next.total;
  doc.lastFeedbackAt = new Date();
  await doc.save();

  const activeCategory = isActivePreference(next)
    ? activeCategoryOf(next)
    : null;

  return {
    previousActive,
    activeCategory,
    activated: !previousActive && Boolean(activeCategory),
    reversed: Boolean(previousActive && activeCategory && previousActive !== activeCategory),
    weakened: Boolean(previousActive && !activeCategory),
    totalEvidence: next.total,
  };
};

/** True when this record's evidence qualifies as an ACTIVE preference. */
categoryPreferenceSchema.methods.isActive = function () {
  return isActivePreference({ tallies: this.tallies, total: this.total });
};

module.exports = mongoose.model("CategoryPreference", categoryPreferenceSchema);
