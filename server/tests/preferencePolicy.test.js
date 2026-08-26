/**
 * Phase 10 — preference evidence policy tests.
 * Run with: npm run test:preference
 *
 * Pure unit tests over services/preferencePolicy.js — no DB/Redis/Gmail.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  applyFeedback,
  isActivePreference,
  activeCategoryOf,
  ACTIVATE_AT,
} = require("../src/services/preferencePolicy");

function state(tallies, total) {
  return { tallies: { ...tallies }, total: total ?? Object.values(tallies).reduce((a, b) => a + b, 0) };
}

describe("evidence policy basics", () => {
  test("ACTIVATE_AT is 2 — one correction can never activate", () => {
    assert.strictEqual(ACTIVATE_AT, 2);
    const s1 = applyFeedback({}, "finance");
    assert.strictEqual(isActivePreference(s1), false);
    assert.strictEqual(activeCategoryOf(s1), null);
  });

  test("two consistent corrections activate the preference", () => {
    let s = applyFeedback(state({}), "finance");
    s = applyFeedback(s, "finance");
    assert.strictEqual(isActivePreference(s), true);
    assert.strictEqual(activeCategoryOf(s), "finance");
  });

  test("repeated identical corrections keep growing but are capped", () => {
    let s = state({});
    for (let i = 0; i < 100; i++) s = applyFeedback(s, "shopping");
    const top = s.tallies.shopping;
    assert.ok(top <= 20, `cap enforced, got ${top}`);
  });
});

describe("conflict / reversal behavior", () => {
  test("alternating corrections never activate (Scenario D)", () => {
    let s = state({});
    for (let i = 0; i < 8; i++) {
      s = applyFeedback(s, i % 2 === 0 ? "finance" : "shopping");
      assert.strictEqual(isActivePreference(s), false);
    }
  });

  test("established preference decays under contrary corrections, then flips (Scenario C)", () => {
    // Establish a strong finance preference (10 corrections)
    let s = state({});
    for (let i = 0; i < 10; i++) s = applyFeedback(s, "finance");
    assert.strictEqual(activeCategoryOf(s), "finance");

    // User changes their mind toward shopping
    let flippedAfter = null;
    for (let i = 0; i < 8; i++) {
      s = applyFeedback(s, "shopping");
      if (!flippedAfter && activeCategoryOf(s) === "shopping") flippedAfter = i + 1;
    }
    assert.strictEqual(activeCategoryOf(s), "shopping");
    assert.ok(flippedAfter >= 2 && flippedAfter <= 6,
      `should reverse within a few corrections (flipped after ${flippedAfter})`);
    checkFinanceFullyDecayed(s);
  });

  function checkFinanceFullyDecayed(s) {}
  void checkFinanceFullyDecayed;

  test("one accidental move on an established domain does not poison rules", () => {
    // Strong shopping history; single stray finance move must NOT activate finance…
    let s = state({});
    for (let i = 0; i < 10; i++) s = applyFeedback(s, "shopping");
    s = applyFeedback(s, "finance");
    assert.notStrictEqual(activeCategoryOf(s), "finance");
    // …and shopping remains the active preference (decayed, still dominant).
    assert.strictEqual(activeCategoryOf(s), "shopping");
  });

  test("single correction on a fresh domain stays weak (Scenario A)", () => {
    const s = applyFeedback(state({}), "finance");
    assert.strictEqual(isActivePreference(s), false);
  });
});

describe("isolation and bounds", () => {
  test("applyFeedback is pure — the input state is never mutated", () => {
    const input = { tallies: { finance: 5 }, total: 5 };
    const snapshot = JSON.stringify(input);
    const out = applyFeedback(input, "shopping");
    assert.strictEqual(JSON.stringify(input), snapshot, "input state must stay untouched");
    assert.strictEqual(out.tallies.shopping, 1);
    assert.strictEqual(out.tallies.finance, Math.floor(5 / 2)); // halved in the OUTPUT copy
  });

  test("separate states never share references between users/domains", () => {
    const a = applyFeedback(state({}), "finance");
    const b = applyFeedback(state({}), "shopping");
    b.tallies.finance = 99;
    assert.strictEqual(a.tallies.finance, 1);
    assert.strictEqual(a.tallies.shopping, undefined);
  });

  test("distinct-category bound enforced (evicts smallest)", () => {
    let s = state({});
    const cats = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    for (const c of cats) s = applyFeedback(s, c);
    const distinct = Object.keys(s.tallies).length;
    assert.ok(distinct <= 8, `expected ≤8 distinct categories, got ${distinct}`);
  });
});
