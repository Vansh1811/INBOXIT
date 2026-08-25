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
