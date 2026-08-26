/**
 * Safe formatter for AI operational telemetry.
 *
 * This module owns no counters or circuit state. It only selects and bounds
 * values from the real classifier status and the current sync's local stats.
 */

const CIRCUIT_STATES = new Set(["closed", "open", "half_open"]);

const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

const milliseconds = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.min(value, 86_400_000) : 0;

const label = (value, fallback = null) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return fallback;
  return value;
};

function buildAiSummary(syncStats = {}, processStatus = {}) {
  const failureCategories = processStatus.failureCategories || {};

  return {
    scope: "process",
    enabled: processStatus.enabled === true,
    provider: label(processStatus.provider, "unknown"),
    model: label(processStatus.model),
    circuitState: CIRCUIT_STATES.has(processStatus.circuitState)
      ? processStatus.circuitState
      : "unknown",
    circuitOpen: processStatus.circuitOpen === true,
    consecutiveFailures: count(processStatus.consecutiveFailures),
    cooldownRemainingMs: milliseconds(processStatus.cooldownRemainingMs),
    retryEligible: processStatus.retryEligible === true,
    recoveries: count(processStatus.recoveries),
    sync: {
      eligible: count(syncStats.eligible),
      attempted: count(syncStats.attempted),
      succeeded: count(syncStats.succeeded),
      failed: count(syncStats.failed),
      skipped: count(syncStats.skipped),
      budgetExhausted: count(syncStats.budgetExhausted),
      skippedDisabled: count(syncStats.skippedDisabled),
      skippedCircuitOpen: count(syncStats.skippedCircuitOpen),
    },
    process: {
      attempts: count(processStatus.attempts),
      successes: count(processStatus.successes),
      failures: count(processStatus.failures),
      skipped: count(processStatus.skipped),
      failureCategories: {
        timeout: count(failureCategories.timeout),
        malformed: count(failureCategories.malformed),
        rateLimited: count(failureCategories.rateLimited),
        http: count(failureCategories.http),
        network: count(failureCategories.network),
      },
    },
  };
}

module.exports = { buildAiSummary };
