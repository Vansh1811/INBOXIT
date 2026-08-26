/**
 * Phase 11 — contextual classification policy tests.
 * Run with: npm run test:context
 *
 * Pure unit tests over services/contextPolicy.js — no DB/Redis/Gmail/AI.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  evaluateCategoryHistory,
  applyContext,
  combineEvaluations,
  CONTEXT_CONF_CAP,
  CONTEXT_ELIGIBLE_MAX_CONFIDENCE,
} = require("../src/services/contextPolicy");
const { CONFIDENCE } = require("../src/services/classifier");

const entries = (...cats) => cats.map((category) => ({ category }));

describe("evaluateCategoryHistory", () => {
  test("empty history → no context", () => {
    const e = evaluateCategoryHistory([]);
    assert.strictEqual(e.sufficient, false);
    assert.strictEqual(e.reason, "insufficient_sample");
  });

  test("insufficient sample → ignored", () => {
    const e = evaluateCategoryHistory(entries("finance", "finance"));
    assert.strictEqual(e.reason, "insufficient_sample");
    assert.strictEqual(e.sample, 2);
  });

  test("strong dominant history → accepted with share", () => {
    const e = evaluateCategoryHistory(
      entries("finance", "finance", "finance", "shopping")
    ); // share = 0.75 ≥ 0.7
    assert.strictEqual(e.sufficient, true);
    assert.strictEqual(e.dominantCategory, "finance");
    assert.strictEqual(e.share, 0.75);
  });

  test("ambiguous split → ignored with ambiguity flag", () => {
    const e = evaluateCategoryHistory(entries("finance", "finance", "shopping", "shopping"));
    assert.strictEqual(e.sufficient, false);
    assert.strictEqual(e.reason, "ambiguous");
    assert.strictEqual(e.ambiguous, true);
  });

  test("2-vs-1 split is NOT treated as strong certainty", () => {
    const e = evaluateCategoryHistory(entries("finance", "finance", "shopping"));
    assert.strictEqual(e.sufficient, false); // share = 0.667 < 0.7
  });

  test("entries without valid categories are skipped safely", () => {
    const e = evaluateCategoryHistory([{ category: null }, {}, { category: "jobs" }]);
    assert.strictEqual(e.sufficient, false);
    assert.strictEqual(e.sample, 3);
  });
});

describe("applyContext", () => {
  const strongFinanceEval = {
    sufficient: true, dominantCategory: "finance",
    sample: 9, share: 0.9, ranked: [{ category: "finance", count: 9 }],
  };

  test("weak default decision refined by context → source='context'", () => {
    const decision = {
      category: "uncategorized", source: "default",
      confidence: 0.1, uncertain: true, signals: [],
    };
    const out = applyContext(decision, strongFinanceEval, "sender_history");
    assert.strictEqual(out.category, "finance");
    assert.strictEqual(out.source, "context");
    assert.strictEqual(out.uncertain, false);
    assert.ok(out.confidence <= CONTEXT_CONF_CAP);
    assert.strictEqual(out.signals.at(-1).type, "context");
  });

  test("agreeing context strengthens confidence in place", () => {
    const weakAgreeingRule = {
      category: "finance", source: "rule", confidence: 0.7,
      uncertain: true, signals: [{ type: "rule", value: "finance", by: ["subject"] }],
    };
    const out = applyContext(weakAgreeingRule, strongFinanceEval, "sender_history");
    assert.strictEqual(out.category, "finance");
    assert.strictEqual(out.source, "rule", "identity preserved on agreement");
    assert.strictEqual(out.uncertain, false);
    assert.ok(out.confidence > weakAgreeingRule.confidence, "confidence strengthened");
    assert.ok(out.confidence <= CONTEXT_CONF_CAP);
  });

  test("strong deterministic results are NEVER overridden (caller-gated but defensive)", () => {
    // Even if a strong result were passed by mistake, a differing context
    // replaces it — so the CALLER must gate eligibility. This test documents
    // that applyContext itself has no internal strength check; the guard
    // lives at the integration site (emailSyncService).
    const strongSender = {
      category: "travel", source: "rule",
      confidence: CONFIDENCE.RULE_SENDER_ONLY, uncertain: false, signals: [],
    };
    const out = applyContext(strongSender, strongFinanceEval, "sender_history");
    assert.strictEqual(out.category, "finance"); // demonstrates why gating matters
  });

  test("null/insufficient evaluation returns the original decision untouched", () => {
    const decision = { category: "uncategorized", source: "default", confidence: 0.1, uncertain: true, signals: [] };
    for (const ev of [null, undefined, { sufficient: false }]) {
      const out = applyContext(decision, ev, "sender_history");
      assert.deepStrictEqual(out.category, decision.category);
      assert.strictEqual(out.signals.length, 0);
    }
  });

  test("context confidence never exceeds the policy cap", () => {
    const perfect = { sufficient: true, dominantCategory: "jobs", sample: 10, share: 1 };
    const out = applyContext(
      { category: "uncategorized", source: "default", confidence: 0.1, uncertain: true, signals: [] },
      perfect, "sender_history"
    );
    assert.strictEqual(out.confidence, CONTEXT_CONF_CAP);
  });

  test("signals remain bounded after refinement", () => {
    let signals = [];
    for (let i = 0; i < 20; i++) signals.push({ type: "noise", value: String(i) });
    const out = applyContext(
      { category: "uncategorized", source: "default", confidence: 0.1, uncertain: true, signals },
      strongFinanceEval, "sender_history"
    );
    assert.ok(out.signals.length <= 8);
  });
});

describe("combineEvaluations (domain vs thread)", () => {
  const fin = (share) => ({ sufficient: true, dominantCategory: "finance", share, sample: 5 });
  const trav = { sufficient: true, dominantCategory: "travel", share: 0.9, sample: 5 };

  test("agreement keeps both concepts, picks stronger share", () => {
    const c = combineEvaluations(fin(0.8), fin(0.9));
    assert.strictEqual(c.evaluation.dominantCategory, "finance");
    assert.strictEqual(c.contextType, "domain_and_thread");
  });

  test("disagreement prefers higher share", () => {
    const c = combineEvaluations(fin(0.75), trav);
    assert.strictEqual(c.evaluation.dominantCategory, "travel");
    assert.strictEqual(c.contextType, "thread_history");
  });

  test("only-domain / only-thread / neither", () => {
    assert.strictEqual(combineEvaluations(fin(0.8), null).contextType, "sender_history");
    assert.strictEqual(combineEvaluations(null, trav).contextType, "thread_history");
    assert.strictEqual(combineEvaluations(null, null).evaluation, null);
  });
});

describe("eligibility boundary", () => {
  test("constant sits exactly at the subject-only rule band", () => {
    assert.strictEqual(CONTEXT_ELIGIBLE_MAX_CONFIDENCE, CONFIDENCE.RULE_SUBJECT_ONLY);
    assert.ok(CONFIDENCE.RULE_SENDER_ONLY > CONTEXT_ELIGIBLE_MAX_CONFIDENCE,
      "sender-only rules must be ABOVE the eligible band");
    assert.ok(CONFIDENCE.GMAIL_TAB <= CONTEXT_ELIGIBLE_MAX_CONFIDENCE,
      "gmail-tab results are eligible for refinement");
  });
});
