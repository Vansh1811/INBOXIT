/**
 * Contextual classification policy (Phase 11) — PURE functions, no I/O.
 *
 * Deterministic evaluation of bounded mailbox history so weak/uncertain
 * deterministic decisions can be refined WITHOUT fabricating certainty:
 *
 *   - a history is usable only with a minimum sample AND a dominant share
 *   - refined confidence is CAPPED below strong rule-sender evidence so
 *     context can never outrank explicit/strong deterministic layers
 *   - agreeing context strengthens an existing weak decision in place
 *   - disagreeing context replaces ONLY weak categories (never strong ones),
 *     and always records provenance via source:"context" + a context signal
 */

// ── Policy constants (named, single source of truth) ─────────────────────────
const MIN_SAMPLE = 3;            // minimum history entries before context counts
const DOMINANCE_SHARE = 0.7;     // top category must hold ≥70% of the sample
const HISTORY_LIMIT = 10;        // max historical entries examined per key
const CONTEXT_CONF_BASE = 0.55;  // floor for a refined contextual confidence
const CONTEXT_CONF_CAP = 0.8;    // hard ceiling — stays BELOW rule-sender (0.85)
/** Decisions at/below this confidence are eligible for context refinement
 *  (default .10, error_fallback 0, gmail_tab .60, subject-only rule .70). */
const CONTEXT_ELIGIBLE_MAX_CONFIDENCE = 0.7;

/**
 * Evaluate a bounded list of historical categories.
 * @param {Array<{category?:string}>} entries
 * @returns evaluation object; `sufficient:false` carries a `reason`.
 */
function evaluateCategoryHistory(entries) {
  if (!Array.isArray(entries)) {
    return { sufficient: false, reason: "invalid_entries", sample: 0 };
  }
  const sample = entries.length;
  if (sample < MIN_SAMPLE) {
    return { sufficient: false, reason: "insufficient_sample", sample };
  }

  const counts = {};
  for (const entry of entries) {
    const c = entry && typeof entry.category === "string" ? entry.category : null;
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  if (Object.keys(counts).length === 0) {
    return { sufficient: false, reason: "no_categories", sample };
  }

  const ranked = Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

  const top = ranked[0];
  const share = top.count / sample;

  if (share < DOMINANCE_SHARE) {
    return {
      sufficient: false,
      reason: "ambiguous",
      sample,
      share,
      ambiguous: true,
      ranked: ranked.slice(0, 3),
    };
  }

  return {
    sufficient: true,
    dominantCategory: top.category,
    sample,
    share,
    ranked: ranked.slice(0, 3),
  };
}

/** Confidence contribution for a dominant history, capped by policy. */
function contextualConfidence(share) {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return Math.min(CONTEXT_CONF_CAP, CONTEXT_CONF_BASE + s * 0.25);
}

function contextSignal(evaluation, contextType) {
  return {
    type: "context",
    value: contextType,
    weight: contextualConfidence(evaluation.share),
    category: evaluation.dominantCategory,
  };
}

/**
 * Apply an evaluated history onto an existing deterministic decision.
 *
 *   agree  → same category/source kept; confidence strengthened (≤ cap)
 *   differ → category replaced by the dominant contextual category with
 *            source:"context" — ONLY for decisions the caller already deemed
 *            eligible (weak); strong results never reach this function.
 *
 * @returns new decision object (original untouched)
 */
function applyContext(decision, evaluation, contextType) {
  if (!evaluation || !evaluation.sufficient) return decision;

  const confidence = contextualConfidence(evaluation.share);
  const ctxSignal = contextSignal(evaluation, contextType);

  if (decision.category === evaluation.dominantCategory) {
    // Agreement strengthens without changing identity/provenance.
    return {
      ...decision,
      confidence: Math.max(decision.confidence, confidence),
      uncertain: false,
      signals: [
        ...(decision.signals || []).slice(0, 7),
        ctxSignal,
      ],
    };
  }

  // Disagreement: context wins over WEAK evidence only (caller-gated).
  return {
    ...decision,
    category: evaluation.dominantCategory,
    source: "context",
    confidence,
    uncertain: false,
    signals: [
      ...(decision.signals || []).slice(0, 7),
      ctxSignal,
    ],
  };
}

/**
 * Combine independent evaluations (domain vs thread) deterministically:
 * prefer the higher dominance share; ties prefer the thread
 * (conversation-specific evidence beats sender-wide averages).
 */
function combineEvaluations(domainEval, threadEval) {
  const dOk = Boolean(domainEval && domainEval.sufficient);
  const tOk = Boolean(threadEval && threadEval.sufficient);

  if (dOk && tOk && domainEval.dominantCategory === threadEval.dominantCategory) {
    return {
      evaluation: domainEval.share >= threadEval.share ? domainEval : threadEval,
      contextType: "domain_and_thread",
    };
  }
  if (tOk && (!dOk || threadEval.share > domainEval.share)) {
    return { evaluation: threadEval, contextType: "thread_history" };
  }
  if (dOk) {
    return { evaluation: domainEval, contextType: "sender_history" };
  }
  return { evaluation: null, contextType: null };
}

module.exports = {
  MIN_SAMPLE,
  DOMINANCE_SHARE,
  HISTORY_LIMIT,
  CONTEXT_CONF_BASE,
  CONTEXT_CONF_CAP,
  CONTEXT_ELIGIBLE_MAX_CONFIDENCE,
  evaluateCategoryHistory,
  contextualConfidence,
  applyContext,
  combineEvaluations,
};
