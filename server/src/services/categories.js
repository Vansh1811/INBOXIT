/**
 * CANONICAL EMAIL CATEGORY CONTRACT
 * =================================
 *
 * Every InboxIt email has EXACTLY ONE primary category, drawn from this
 * vocabulary. This module is the single source of truth — classifier,
 * sync service, API queries, and the frontend CAT map must all agree
 * with these values.
 *
 * Classification precedence (highest wins):
 *   1. Per-user learned sender preference   (user moved mail from this sender)
 *   2. Rule-based match                     (classifier RULES, priority order)
 *   3. Gmail native tab                     (CATEGORY_PROMOTIONS etc.)
 *   4. uncategorized                        (fallback)
 */

const UNCATEGORIZED = "uncategorized";

const CATEGORIES = [
  UNCATEGORIZED,
  "jobs",
  "social",
  "finance",
  "travel",
  "food",
  "shopping",
  "health",
  "education",
  "newsletters",
  "personal",
  "promotions",
  "updates",
];

const CATEGORY_SET = new Set(CATEGORIES);

/**
 * Map of Gmail native tab labels → InboxIt canonical categories.
 * Anything not listed here is ignored.
 */
const GMAIL_TAB_MAP = {
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
  CATEGORY_FORUMS: "newsletters",
};

function isValidCategory(value) {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

/** Extract the sender domain from a raw From header value. */
function extractSenderDomain(from = "") {
  const match = String(from).match(/<([^>]+)>/) || [null, String(from)];
  const address = match[1].trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at === -1) return "";
  return address.slice(at + 1);
}

module.exports = {
  UNCATEGORIZED,
  CATEGORIES,
  GMAIL_TAB_MAP,
  isValidCategory,
  extractSenderDomain,
};
