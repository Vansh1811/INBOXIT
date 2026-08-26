/**
 * Classification contract tests — run with: npm run test:classification
 * Pure unit tests; no MongoDB/Redis required.
 */

process.env.TOKEN_ENCRYPTION_KEY = Array.from({ length: 64 }, (_, i) =>
  (i % 16).toString(16)
).join("");
process.env.JWT_SECRET = "test-jwt-secret";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { classify, fromGmailTabs } = require("../src/services/classifier");
const {
  classifyDetailed,
  fallbackClassification,
  CONFIDENCE,
  UNCERTAIN_BELOW,
} = require("../src/services/classifier");
const {
  CATEGORIES,
  UNCATEGORIZED,
  GMAIL_TAB_MAP,
  isValidCategory,
  extractSenderDomain,
} = require("../src/services/categories");

describe("category vocabulary", () => {
  test("is a fixed, non-empty list containing the fallback", () => {
    assert.ok(CATEGORIES.length >= 10);
    assert.ok(CATEGORIES.includes(UNCATEGORIZED));
    assert.strictEqual(new Set(CATEGORIES).size, CATEGORIES.length, "no duplicates");
  });

  test("every classifier rule maps to a canonical category", () => {
    const { RULES } = require("../src/services/classifier");
    for (const rule of RULES) {
      assert.ok(
        isValidCategory(rule.category),
        `rule category "${rule.category}" is not in canonical vocabulary`
      );
    }
  });

  test("every Gmail tab mapping targets a canonical category", () => {
    for (const mapped of Object.values(GMAIL_TAB_MAP)) {
      assert.ok(isValidCategory(mapped), `tab map target "${mapped}" invalid`);
    }
  });
});

describe("classify() — single-category contract", () => {
  test("returns exactly one string", () => {
    const out = classify("Naukri Alerts <job-alerts@naukri.com>", "3 new jobs match your profile");
    assert.strictEqual(typeof out, "string");
    assert.strictEqual(out, "jobs");
  });

  test("sender rule wins by priority (finance sender)", () => {
    assert.strictEqual(
      classify("Razorpay Payments <noreply@razorpay.com>", "Payment received ₹4,999"),
      "finance"
    );
  });

  test("subject keyword alone can classify", () => {
    assert.strictEqual(
      classify("Random Person <someone@unknowncorp.in>", "Your ride receipt from Monday"),
      "travel"
    );
  });

  test("first priority match wins when several rules fire", () => {
    // github matches social (priority 2), notifications@ matches promotions (last).
    // Social must win deterministically.
    assert.strictEqual(
      classify("GitHub <notifications@github.com>", "issue opened in repo"),
      "social"
    );
  });

  test("no match → uncategorized", () => {
    assert.strictEqual(classify("Stranger <x@nowhere.dev>", "Quarterly numbers"), UNCATEGORIZED);
  });

  test("empty inputs → uncategorized without crashing", () => {
    assert.strictEqual(classify("", ""), UNCATEGORIZED);
    assert.strictEqual(classify(), UNCATEGORIZED);
  });
});

describe("classify() — user preference precedence", () => {
  test("learned preference overrides rule match", () => {
    const prefs = { "razorpay.com": "shopping" };
    assert.strictEqual(
      classify("Razorpay <noreply@razorpay.com>", "Payment received", prefs),
      "shopping"
    );
  });

  test("preference applies even when rules find nothing", () => {
    const prefs = { "nowhere.dev": "work".replace("work", "personal") };
    assert.strictEqual(classify("A <b@nowhere.dev>", "hello", prefs), "personal");
  });

  test("non-canonical preference values are ignored", () => {
    const prefs = { "naukri.com": "not-a-real-category" };
    assert.strictEqual(
      classify("Naukri <alerts@naukri.com>", "job alert", prefs),
      "jobs",
      "invalid pref must fall through to rules"
    );
  });

  test("preferences are domain-scoped (other senders unaffected)", () => {
    const prefs = { "swiggy.com": "promotions" };
    assert.strictEqual(
      classify("Zomato <orders@zomato.com>", "Order confirmed", prefs),
      "food"
    );
  });
});

describe("fromGmailTabs()", () => {
  test("maps Gmail CATEGORY_* labels to canonical categories", () => {
    assert.strictEqual(fromGmailTabs(["CATEGORY_PROMOTIONS"]), "promotions");
    assert.strictEqual(fromGmailTabs(["CATEGORY_SOCIAL"]), "social");
    assert.strictEqual(fromGmailTabs(["CATEGORY_UPDATES"]), "updates");
    assert.strictEqual(fromGmailTabs(["CATEGORY_FORUMS"]), "newsletters");
  });

  test("ignores non-tab labels and returns null when absent", () => {
    assert.strictEqual(fromGmailTabs(["INBOX", "UNREAD", "TRASH"]), null);
    assert.strictEqual(fromGmailTabs([]), null);
  });
});

describe("classifyDetailed (Phase 8 decision contract)", () => {
  test("contract shape: canonical fields, bounded signals, no content", () => {
    const d = classifyDetailed(
      "Stripe Billing <billing@stripe.com>",
      "Your invoice is ready",
      {},
      ["INBOX"]
    );
    assert.strictEqual(typeof d.category, "string");
    assert.strictEqual(typeof d.confidence, "number");
    assert.strictEqual(typeof d.uncertain, "boolean");
    assert.ok(["preference", "rule", "gmail_tab", "default"].includes(d.source));
    assert.ok(d.signals.length <= require("../src/services/classifier").MAX_SIGNALS);
    // Signals must never carry message content
    const flat = JSON.stringify(d.signals);
    assert.ok(!flat.includes("invoice"), "subject text must not leak into signals");
  });

  test("strong sender+subject agreement → high confidence, not uncertain", () => {
    const d = classifyDetailed(
      "Naukri Alerts <alerts@naukri.com>",
      "3 new jobs match your profile",
      {}, []
    );
    assert.strictEqual(d.category, "jobs");
    assert.strictEqual(d.source, "rule");
    assert.strictEqual(d.confidence, CONFIDENCE.RULE_SENDER_AND_SUBJECT);
    assert.strictEqual(d.uncertain, false);
    assert.deepStrictEqual(d.signals[0].by, ["from", "subject"]);
  });

  test("sender-only rule match → sender band confidence", () => {
    const d = classifyDetailed(
      "Razorpay Payments <noreply@razorpay.com>", "Receipt for order #1234", {}, []
    );
    assert.strictEqual(d.category, "finance");
    assert.strictEqual(d.confidence, CONFIDENCE.RULE_SENDER_ONLY);
    assert.strictEqual(d.uncertain, false);
  });

  test("subject-only rule match → weak band AND uncertain=true", () => {
    const d = classifyDetailed(
      "Random Person <someone@unknowncorp.io>", "Your ticket to success", {}, []
    );
    assert.strictEqual(d.category, "travel");
    assert.strictEqual(d.confidence, CONFIDENCE.RULE_SUBJECT_ONLY);
    assert.strictEqual(d.confidence < UNCERTAIN_BELOW, true);
    assert.strictEqual(d.uncertain, true, "keyword-only matches are AI-fallback candidates");
  });

  test("user preference beats rules and reports its own source/band", () => {
    const d = classifyDetailed(
      "Naukri <alerts@naukri.com>", "job alert",
      { "naukri.com": "promotions" }, []
    );
    assert.strictEqual(d.category, "promotions");
    assert.strictEqual(d.source, "preference");
    assert.strictEqual(d.confidence, CONFIDENCE.USER_PREFERENCE);
    assert.strictEqual(d.uncertain, false);
    assert.strictEqual(d.signals[0].type, "user_preference");
    assert.strictEqual(d.signals[0].value, "naukri.com");
  });

  test("invalid preference values are ignored entirely", () => {
    const d = classifyDetailed(
      "Naukri <alerts@naukri.com>", "job alert",
      { "naukri.com": "not-a-category" }, []
    );
    assert.strictEqual(d.category, "jobs");
    assert.strictEqual(d.source, "rule");
  });

  test("gmail tab used only when rules find nothing", () => {
    const d = classifyDetailed("X <x@nowhere.dev>", "totally opaque", {}, ["CATEGORY_UPDATES"]);
    assert.strictEqual(d.category, "updates");
    assert.strictEqual(d.source, "gmail_tab");
    assert.strictEqual(d.confidence, CONFIDENCE.GMAIL_TAB);
    // Rules DID fire for gmail-tab emails? No — rules found nothing here.
    assert.strictEqual(d.signals[0].type, "gmail_tab");
  });

  test("no meaningful evidence → default with explicit uncertainty", () => {
    const d = classifyDetailed("Stranger <a@b.xyz>", "Quarterly numbers attached", {}, []);
    assert.strictEqual(d.category, "uncategorized");
    assert.strictEqual(d.source, "default");
    assert.strictEqual(d.confidence, CONFIDENCE.DEFAULT);
    assert.strictEqual(d.uncertain, true);
  });

  test("conflicting rules recorded as bounded conflict signals", () => {
    // linkedin matches jobs.from (priority 1), social.from (2) AND
    // promotions.from (11). Priority decides; conflicts are recorded.
    const d = classifyDetailed(
      "LinkedIn <notifications@linkedin.com>", "you have new connections", {}, []
    );
    assert.strictEqual(d.category, "jobs");
    const conflicts = d.signals.filter((s) => s.type === "conflict").map((s) => s.value);
    assert.deepStrictEqual(conflicts.sort(), ["promotions", "social"]);
    assert.ok(d.signals.length <= require("../src/services/classifier").MAX_SIGNALS);
  });

  test("parity: classify() === classifyDetailed().category across samples", () => {
    const samples = [
      ["Swiggy <orders@swiggy.in>", "Order confirmed"],
      ["HDFC Bank <alerts@hdfcbank.net>", "Transaction alert"],
      ["Unknown <u@nowhere.dev>", "random text"],
      ["Uber India <receipts@uber.com>", "Your trip receipt"],
    ];
    for (const [from, subject] of samples) {
      assert.strictEqual(
        classify(from, subject),
        classifyDetailed(from, subject, {}).category,
        `parity broken for: ${from}`
      );
    }
  });
});

describe("fallbackClassification (sync isolation contract)", () => {
  test("explicit low-confidence fallback shape", () => {
    const f = fallbackClassification("regex exploded");
    assert.strictEqual(f.category, "uncategorized");
    assert.strictEqual(f.source, "error_fallback");
    assert.strictEqual(f.confidence, 0);
    assert.strictEqual(f.uncertain, true);
    assert.match(f.signals[0].value, /regex exploded/);
  });

  test("fallback reason is length-bounded (metadata stays small)", () => {
    const f = fallbackClassification("x".repeat(5000));
    assert.ok(f.signals[0].value.length <= 120);
  });
});

describe("extractSenderDomain()", () => {
  test("parses 'Name <local@domain>' headers", () => {
    assert.strictEqual(extractSenderDomain('Swiggy Care <no-reply@swiggy.in>'), "swiggy.in");
  });

  test("handles bare addresses", () => {
    assert.strictEqual(extractSenderDomain("billing@hdfcbank.net"), "hdfcbank.net");
  });

  test("lowercases and ignores garbage", () => {
    assert.strictEqual(extractSenderDomain("Weird <USER@Example.COM>"), "example.com");
    assert.strictEqual(extractSenderDomain("no-address-here"), "");
    assert.strictEqual(extractSenderDomain(""), "");
    assert.strictEqual(extractSenderDomain(undefined), "");
  });
});
