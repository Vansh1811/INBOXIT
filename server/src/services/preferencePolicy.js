/**
 * Deterministic preference-evidence policy (Phase 10).
 *
 * Pure functions only — no MongoDB, no logger. The CategoryPreference model
 * persists the state these functions produce; the sync pipeline's
 * `loadUserPreferences` consumes only ACTIVE preferences.
 *
 * Policy (deterministic, explainable, bounded, reversible):
 *   - Every explicit correction decays all OTHER category tallies by half
 *     (floor) and increments the chosen category (capped).
 *     → consistent corrections grow quickly; an old dominant preference
 *       fades within a few contrary corrections instead of trapping the user.
 *   - A preference is ACTIVE only when the top category has at least
 *     ACTIVATE_AT corrections AND leads the runner-up by DOMINANCE_MARGIN.
 *     → one accidental correction can never create an override.
 *   - Alternating corrections keep every tally at 0/1 ⇒ never active.
 *     → conflicting history produces no unjustified confidence.
 */

const ACTIVATE_AT = 2;            // minimum corrections for the top category
const DOMINANCE_MARGIN = 2;       // required lead over the runner-up
const PER_CATEGORY_CAP = 20;      // bound any single tally
const MAX_DISTINCT_CATEGORIES = 8;// bound map size

/** Normalize unknown/legacy state into a safe working copy. */
function normalizeState(state) {
  const tallies = {};
  const src = state && state.tallies && typeof state.tallies === "object"
    ? state.tallies : {};
  for (const [k, v] of Object.entries(src)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && typeof k === "string" && k) tallies[k] = Math.floor(n);
  }
  const total = Number(state?.total) || Object.values(tallies).reduce((a, b) => a + b, 0);
  return { tallies, total };
}

/**
 * Record one explicit correction for `newCategory`.
 * @param {{tallies?:object, total?:number}} state
 * @param {string} newCategory canonical category
 */
function applyFeedback(state, newCategory) {
  const { tallies } = normalizeState(state);

  // Recency bias: competing categories decay toward irrelevance.
  for (const k of Object.keys(tallies)) {
    if (k !== newCategory) {
      const next = Math.min(PER_CATEGORY_CAP, Math.floor(tallies[k] / 2));
      if (next <= 0) delete tallies[k];
      else tallies[k] = next;
    }
  }

  // Strengthen the chosen category.
  tallies[newCategory] = Math.min(PER_CATEGORY_CAP, (tallies[newCategory] || 0) + 1);

  // Bound distinct categories: evict the smallest tallies first.
  let entries = Object.entries(tallies);
  while (entries.length > MAX_DISTINCT_CATEGORIES) {
    entries.sort((a, b) => a[1] - b[1]);
    const [smallestKey] = entries.shift();
    delete tallies[smallestKey];
    entries = Object.entries(tallies);
  }

  const total = Object.values(tallies).reduce((a, b) => a + b, 0);
  return { tallies, total };
}

/** Ranked view: [{category,count}] descending. */
function ranking(state) {
  const { tallies } = normalizeState(state);
  return Object.entries(tallies)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
}

/**
 * Is the evidence strong enough for an ACTIVE preference?
 * Requires both an absolute minimum and a dominance lead over the runner-up.
 */
function isActivePreference(state) {
  const ranked = ranking(state);
  if (ranked.length === 0) return false;
  const top = ranked[0];
  const second = ranked[1]?.count ?? 0;
  return top.count >= ACTIVATE_AT && top.count - second >= DOMINANCE_MARGIN;
}

/** The active preferred category, or null when not strong enough. */
function activeCategoryOf(state) {
  if (!isActivePreference(state)) return null;
  return ranking(state)[0].category;
}

module.exports = {
  ACTIVATE_AT,
  DOMINANCE_MARGIN,
  PER_CATEGORY_CAP,
  MAX_DISTINCT_CATEGORIES,
  normalizeState,
  applyFeedback,
  ranking,
  isActivePreference,
  activeCategoryOf,
};
