// src/services/classifier.js

/**
 * Rule-based email classifier with an explicit, inspectable decision layer.
 *
 * Canonical ordering (highest precedence first):
 *   1. user_preference   — learned from the user's own corrections
 *   2. rule              — first RULES[] match by ascending priority
 *   3. gmail_tab         — Google's native CATEGORY_* mapping
 *   4. default           — uncategorized
 *
 * `classify()` preserves the historical string-only contract.
 * `classifyDetailed()` returns the full internal decision contract
 * (category + source + heuristic confidence + bounded signals) that the
 * future AI fallback layer will consume.
 *
 * Extend by adding entries to RULES (lower priority number = higher
 * precedence). Category values MUST exist in services/categories.js.
 */

const {
  UNCATEGORIZED,
  GMAIL_TAB_MAP,
  isValidCategory,
  extractSenderDomain,
} = require("./categories");

/**
 * Deterministic heuristic bands — NOT statistically calibrated probabilities.
 * They encode "how strong is this class of evidence" so the decision layer
 * (and the future AI fallback trigger) can reason about uncertainty.
 */
const CONFIDENCE = {
  USER_PREFERENCE: 0.95,        // explicit human intent
  RULE_SENDER_AND_SUBJECT: 0.9, // two independent signals agree
  RULE_SENDER_ONLY: 0.85,       // strong vendor/domain identity
  RULE_SUBJECT_ONLY: 0.7,       // keyword collision risk
  GMAIL_TAB: 0.6,               // Google's own coarse classification
  DEFAULT: 0.1,                 // no meaningful evidence
};

/** Results with confidence below this are marked uncertain (AI-trigger candidates). */
const UNCERTAIN_BELOW = 0.75;

/** Hard cap on explainability signals attached to one result. */
const MAX_SIGNALS = 8;

const RULES = [
  // 1) JOBS
  {
    category: "jobs",
    priority: 1,
    from: /naukri|internshala|wellfound|hirist|instahyre|shine|timesjobs|indeed|apna|foundit|glassdoor|linkedin(job alerts?)?|careers?@|jobs?@|hr@/i,
    subject: /(job|hiring|opening|vacancy|position|role|shortlisted|interview|assessment|online test|offer letter|recruitment|application status)/i,
  },

  // 2) SOCIAL
  {
    category: "social",
    priority: 2,
    from: /linkedin|facebook|instagram|twitter|x\.com|discord|slack|github|gitlab|stackoverflow|reddit|quora/i,
    subject: /(mentioned you|commented|replied|liked|follower|following|connection|invite|tagged you|pull request|issue (opened|closed))/i,
  },

  // 3) FINANCE
  {
    category: "finance",
    priority: 3,
    from: /hdfc|icici|sbi|axis|kotak|idfc first|yes bank|indusind|federal bank|bank of baroda|pnb|union bank|canara bank|phonepe|paytm|google pay|gpay|amazon pay|bhim|mobikwik|razorpay|billdesk|payu|cashfree/i,
    subject: /(statement|transaction alert|txn|credited|debited|payment (successful|failed)|upi ref|utr|imps|neft|rtgs|refund|emi due|bill generated|minimum due|credit card|loan)/i,
  },

  // 4) TRAVEL — cabs + trains + flights + hotels
  {
    category: "travel",
    priority: 4,
    from: /uber|ola|rapido|indrive|irctc|ixigo|makemytrip|goibibo|yatra|cleartrip|booking\.com|airbnb|agoda|oyo|indigo|spicejet|airasia|vistara|air india|akasa air|trip\.com/i,
    subject: /(your ride|trip (started|completed)|ride (invoice|receipt)|driver (is arriving|details)|pickup|drop|fare|booking (confirmation|confirmed)|pnr|ticket|flight|train|bus|hotel|boarding pass|check[- ]in|check[- ]out|itinerary|reschedule|cancellation|refund issued for booking)/i,
  },

  // 5) FOOD — delivery + grocery
  {
    category: "food",
    priority: 5,
    from: /swiggy|zomato|blinkit|instamart|dunzo|bigbasket|zepto|domino'?s|pizza hut|eatfit|freshmenu/i,
    subject: /(order (confirmed|accepted|received|delivered)|is being prepared|out for delivery|delivery partner|track your order|food order|grocery order|refund for your order)/i,
  },

  // 6) SHOPPING — ecommerce
  {
    category: "shopping",
    priority: 6,
    from: /amazon|flipkart|myntra|ajio|meesho|nykaa|tatacliq|croma|reliance digital|snapdeal|jiomart|ikea|pepperfry|firstcry/i,
    subject: /(order (placed|confirmed|details)|shipped|dispatched|out for delivery|delivered|package|tracking id|track shipment|return (initiated|approved)|replacement|refund (processed|initiated)|invoice|warranty)/i,
  },

  // 7) HEALTH
  {
    category: "health",
    priority: 7,
    from: /1mg|pharmeasy|practo|apollo|tata ?health|indiamart diagnostics|thyrocare|lal(path)? labs?|healthifyme|cult\.fit|cure\.fit/i,
    subject: /prescription|doctor appointment|consultation|teleconsult|lab report|test report|diagnostic report|health checkup|medicine order|refill reminder|fitness plan|diet plan|workout plan/i,
  },

  // 8) EDUCATION / COURSES
  {
    category: "education",
    priority: 8,
    from: /unacademy|byju'?s|vedantu|physicswallah|upgrad|coursera|udemy|edx|datacamp|codechef|leetcode|codeforces|hackerrank|hackerearth|campusx|scaler|masai|pw skills/i,
    subject: /course|enroll(ed)?|registration|class (schedule|reminder)|live class|lecture|assignment|quiz|test series|mock test|exam|certificate|completion|cohort|bootcamp|webinar|masterclass|workshop/i,
  },

  // 9) NEWSLETTERS / UPDATES (blogs, dev digests, Substack)
  {
    category: "newsletters",
    priority: 9,
    from: /substack|newsletter|tinyletter|buttondown|mailchimp|sendgrid|beehiiv|convertkit|hashnode|dev\.to|daily dev|info@|updates@|news@/i,
    subject: /newsletter|weekly (roundup|digest)|daily (digest|update)|changelog|release notes|product update|what's new|this week in|issue #[0-9]+/i,
  },

  // 10) PERSONAL (consumer mailbox providers + human-sounding subjects)
  {
    category: "personal",
    priority: 10,
    from: /gmail\.com|outlook\.com|yahoo\.com|proton\.me|icloud\.com/i,
    subject: /(hey|hi|hello|long time|checking in|catch up|invitation|wedding|birthday|housewarming|congratulations)/i,
  },

  // 11) PROMOTIONS – generic marketing catch-all, lowest priority
  {
    category: "promotions",
    priority: 11,
    from: /no[-_.]?reply|noreply|marketing|offers?|promo|deals?|sales?|campaign|mailer|notifications?@/i,
    subject: /sale|discount|offer|deal|coupon|cashback|limited time|hurry|last day|flat [0-9]{2}% off|exclusive|special price|festive sale|big billion|great indian festival/i,
  },
];

/** Evaluate every rule; returns ordered candidates with match provenance. */
function evaluateRules(fromLower, subjectLower) {
  const candidates = [];
  for (const rule of RULES) {
    const matchedBy = [];
    if (rule.from.test(fromLower)) matchedBy.push("from");
    if (rule.subject.test(subjectLower)) matchedBy.push("subject");
    if (matchedBy.length > 0) {
      candidates.push({
        category: rule.category,
        priority: rule.priority,
        matchedBy,
      });
    }
  }
  return candidates.sort((a, b) => a.priority - b.priority);
}

function confidenceForRuleMatch(matchedBy) {
  if (matchedBy.includes("from") && matchedBy.includes("subject"))
    return CONFIDENCE.RULE_SENDER_AND_SUBJECT;
  if (matchedBy.includes("from")) return CONFIDENCE.RULE_SENDER_ONLY;
  return CONFIDENCE.RULE_SUBJECT_ONLY;
}

/** Resolve the Gmail native tab → canonical category, if any. */
function fromGmailTabs(gmailLabels = []) {
  for (const label of gmailLabels) {
    const mapped = GMAIL_TAB_MAP[label];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Full internal decision contract (Phase 8).
 *
 * @param {string} from      raw From header (untrusted input — coerced)
 * @param {string} subject   raw subject   (untrusted input — coerced)
 * @param {Object<string,string>} [userPrefs]  senderDomain → canonical category
 * @param {string[]}         [gmailLabels]       raw Gmail label ids
 * @returns {{
 *   category: string,
 *   source: "preference"|"rule"|"gmail_tab"|"default"|"error_fallback",
 *   confidence: number,
 *   uncertain: boolean,
 *   signals: Array<{type:string, value:string, weight:number, by?:string[]}>,
 * }} decision — `signals` is bounded and contains NO message content.
 */
function classifyDetailed(from = "", subject = "", userPrefs = {}, gmailLabels = []) {
  const f = String(from).toLowerCase();
  const s = String(subject).toLowerCase();
  const domain = extractSenderDomain(from);
  const signals = [];

  // 1) Learned user preference — strongest possible evidence
  if (
    domain &&
    userPrefs &&
    Object.prototype.hasOwnProperty.call(userPrefs, domain) &&
    isValidCategory(userPrefs[domain])
  ) {
    signals.push({
      type: "user_preference",
      value: domain,
      weight: CONFIDENCE.USER_PREFERENCE,
    });
    return {
      category: userPrefs[domain],
      source: "preference",
      confidence: CONFIDENCE.USER_PREFERENCE,
      uncertain: false,
      signals: signals.slice(0, MAX_SIGNALS),
    };
  }

  // 2) Rule engine — first match by priority wins; record conflicts
  const candidates = evaluateRules(f, s);
  if (candidates.length > 0) {
    const best = candidates[0];
    const confidence = confidenceForRuleMatch(best.matchedBy);

    signals.push({
      type: "rule",
      value: best.category,
      weight: confidence,
      by: best.matchedBy,
    });
    for (const other of candidates.slice(1, 4)) {
      signals.push({ type: "conflict", value: other.category, weight: null });
    }

    return {
      category: best.category,
      source: "rule",
      confidence,
      uncertain: confidence < UNCERTAIN_BELOW,
      signals: signals.slice(0, MAX_SIGNALS),
    };
  }

  // 3) Gmail's own tab classification — weaker, but real evidence
  for (const label of gmailLabels || []) {
    const mapped = GMAIL_TAB_MAP[label];
    if (mapped) {
      signals.push({
        type: "gmail_tab",
        value: label,
        weight: CONFIDENCE.GMAIL_TAB,
      });
      return {
        category: mapped,
        source: "gmail_tab",
        confidence: CONFIDENCE.GMAIL_TAB,
        uncertain: false,
        signals: signals.slice(0, MAX_SIGNALS),
      };
    }
  }

  // 4) Default — explicitly LOW confidence / uncertain
  return {
    category: UNCATEGORIZED,
    source: "default",
    confidence: CONFIDENCE.DEFAULT,
    uncertain: true,
    signals,
  };
}

/**
 * Explicit fallback contract for classification failures.
 *
 * Used by the sync pipeline when the classifier itself throws: ingestion must
 * continue (with an honest low-confidence placeholder) rather than dropping
 * the message. Marked uncertain so the future AI layer can revisit it.
 */
function fallbackClassification(reason) {
  return {
    category: UNCATEGORIZED,
    source: "error_fallback",
    confidence: 0,
    uncertain: true,
    signals: [{ type: "error_fallback", value: String(reason || "unknown").slice(0, 120), weight: 0 }],
  };
}

/**
 * Backward-compatible string-only API.
 * @returns {string} canonical category
 */
const classify = (from = "", subject = "", userPrefs = {}) => {
  const domain = extractSenderDomain(from);
  if (domain && Object.prototype.hasOwnProperty.call(userPrefs, domain)) {
    const pref = userPrefs[domain];
    if (isValidCategory(pref)) return pref;
  }

  const f = String(from).toLowerCase();
  const s = String(subject).toLowerCase();

  const rule = RULES.filter((r) => r.from.test(f) || r.subject.test(s)).sort(
    (a, b) => a.priority - b.priority
  )[0];

  return rule ? rule.category : UNCATEGORIZED;
};

module.exports = {
  classify,
  classifyDetailed,
  fallbackClassification,
  fromGmailTabs,
  evaluateRules,
  RULES,
  CONFIDENCE,
  UNCERTAIN_BELOW,
  MAX_SIGNALS,
};
