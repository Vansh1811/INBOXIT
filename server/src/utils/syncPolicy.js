/**
 * Sync-cursor advancement policy (O-H1).
 *
 * Invariant: a Gmail history cursor must NEVER be advanced past messages
 * that failed to ingest — doing so permanently orphans them (their history
 * records are consumed and never revisited).
 *
 * Policy:
 *   - errors === 0            → advance; reset the errored streak
 *   - errors > 0, under cap   → RETAIN previous cursor; streak += 1
 *                               (next poll re-processes the same window;
 *                                upserts make redelivery harmless)
 *   - errors > 0, cap reached → advance anyway ("poison window" escape) and
 *                               flag partial so the UI can warn the user.
 *
 * The same policy governs the chunked-sync resume token: retaining it makes
 * manual load-more/restarts re-walk the failed window instead of skipping it.
 */

const POISON_WINDOW_RUNS = 3;

/**
 * @param {{ errors: number, previousErroredRuns?: number }} p
 * @returns {{ advance: boolean, gaveUp: boolean, newStreak: number }}
 */
function shouldAdvanceCursor({ errors = 0, previousErroredRuns = 0 } = {}) {
  const errs = Number(errors) || 0;

  if (errs <= 0) {
    return { advance: true, gaveUp: false, newStreak: 0 };
  }

  const streak = (Number(previousErroredRuns) || 0) + 1;
  if (streak >= POISON_WINDOW_RUNS) {
    // Poison window: repeatedly failing on the same slice would block all
    // newer mail forever. Advance past it and surface the loss.
    return { advance: true, gaveUp: true, newStreak: 0 };
  }

  return { advance: false, gaveUp: false, newStreak: streak };
}

module.exports = { shouldAdvanceCursor, POISON_WINDOW_RUNS };
