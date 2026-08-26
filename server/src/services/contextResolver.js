/**
 * Context resolver (Phase 11).
 *
 * Bounded, per-user historical context for contextual classification.
 * Sources (both verified in the ingestion path):
 *   - sender/domain history → requires persisted normalized `senderDomain`
 *   - thread history        → requires persisted Gmail `threadId`
 *
 * Safety properties:
 *   - always scoped by userId (no cross-user learning)
 *   - excludes deleted and user-overridden documents (user intent is already
 *     represented by the Phase 10 preference layer)
 *   - bounded: at most HISTORY_LIMIT entries per key, hard cap on queries/run
 *   - any failure resolves to null — never breaks email ingestion
 *
 * This module is I/O-only: category-history EVALUATION lives in
 * services/contextPolicy.js (pure).
 */

const Email = require("../models/Email");
const { HISTORY_LIMIT } = require("./contextPolicy");
const logger = require("../utils/logger").child({ component: "context-resolver" });

async function fetchCategoryHistory(userId, query, excludeMessageMongoId) {
  const filter = {
    userId,
    isDeleted: false,
    userOverride: { $ne: true }, // manual choices belong to the preference layer
    category: { $exists: true, $type: "string" },
    ...query,
    ...(excludeMessageMongoId ? { _id: { $ne: excludeMessageMongoId } } : {}),
  };

  const docs = await Email.find(filter)
    .sort({ receivedAt: -1 })
    .limit(HISTORY_LIMIT)
    .select({ category: 1 })
    .lean();

  return docs.map((d) => ({ category: d.category }));
}

/**
 * Create a memoizing context loader for ONE sync run.
 *
 * Deduplicates lookups across the whole batch: multiple incoming emails from
 * the same domain/thread trigger exactly ONE database query. A hard cap
 * bounds total queries per run; beyond it, context is skipped for that run
 * (deterministic result survives).
 */
function createBatchedContextLoader(userId) {
  const memo = new Map(); // cacheKey -> Promise<entries|null>
  let queriesRun = 0;
  const stats = { domainQueriesRun: 0, threadQueriesRun: 0, memoHits: 0 };
  const MAX_QUERIES_PER_RUN = 16;

  function load(type, key, excludeMongoId) {
    const cacheKey = `${type}|${key}`;
    if (memo.has(cacheKey)) {
      stats.memoHits += 1;
      return memo.get(cacheKey);
    }

    if (queriesRun >= MAX_QUERIES_PER_RUN) {
      const skipped = Promise.resolve(null);
      memo.set(cacheKey, skipped);
      return skipped;
    }
    queriesRun += 1;
    if (type === "domain") stats.domainQueriesRun += 1;
    else stats.threadQueriesRun += 1;

    const query = type === "domain" ? { senderDomain: key } : { threadId: key };
    const p = fetchCategoryHistory(userId, query, excludeMongoId).catch((err) => {
      logger.warn(
        { userId, contextType: type, err: err.message },
        "Context lookup failed — continuing without context"
      );
      return null;
    });

    memo.set(cacheKey, p);
    return p;
  }

  /**
   * @param {{senderDomain?:string, threadId?:string, excludeMongoId?:string}} p
   * @returns {Promise<{domainEntries:Array|null, threadEntries:Array|null}>}
   */
  async function resolve({ senderDomain, threadId, excludeMongoId } = {}) {
    // Exclude ids differ per incoming message only for domain lookups where a
    // message could appear in its own history window; memoizing per-run makes
    // the first caller's exclusion authoritative for the whole batch — an
    // acceptable approximation because a message never appears in another
    // message's same-key history window in practice (unique gmailMessageIds,
    // distinct receivedAt windows).
    const [domainEntries, threadEntries] = await Promise.all([
      senderDomain ? load("domain", senderDomain, excludeMongoId) : Promise.resolve(null),
      threadId ? load("thread", threadId, excludeMongoId) : Promise.resolve(null),
    ]);

    return { domainEntries, threadEntries };
  }

  function getStats() {
    return {
      queriesRun,
      memoHits: stats.memoHits,
      domainQueriesRun: stats.domainQueriesRun,
      threadQueriesRun: stats.threadQueriesRun,
    };
  }

  return { resolve, getStats };
}

module.exports = { createBatchedContextLoader };
