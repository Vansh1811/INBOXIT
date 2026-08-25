// src/services/classifier.js

/**
 * Rule-based email classifier — SINGLE canonical category output.
 *
 * Rules are evaluated in priority order; the FIRST match wins and its
 * `category` value is returned. This matches InboxIt's product model:
 * each email lives in exactly one folder.
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

/**
 * Resolve the Gmail native tab → canonical category, if any.
 * @param {string[]} gmailLabels
 * @returns {string|null}
 */
function fromGmailTabs(gmailLabels = []) {
  for (const label of gmailLabels) {
    const mapped = GMAIL_TAB_MAP[label];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Classify an email into exactly ONE canonical category.
 *
 * Precedence:
 *   1. userPrefs[senderDomain]   — learned from the user's own corrections
 *   2. first matching rule       — by ascending priority number
 *   3. Gmail tab mapping         — applied by caller via fromGmailTabs()
 *
 * @param {string} from      raw From header
 * @param {string} subject
 * @param {Object<string,string>} userPrefs  map of senderDomain → category
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

module.exports = { classify, fromGmailTabs, RULES };
