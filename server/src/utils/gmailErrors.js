/**
 * Gmail API error classifier (O-H3).
 *
 * Distinguishes failure categories so callers can react correctly instead of
 * treating every refresh/API error as "revoked credentials":
 *
 *   revoked      — credentials are invalid/revoked; user MUST re-login.
 *                  Only this class may stop live tracking or force logout.
 *   rate_limited — quota/429; back off and retry normally.
 *   missing      — the target resource no longer exists (404/410).
 *   transient    — network errors, Google 5xx, unknown shapes. Default:
 *                  fail-safe toward retrying.
 *
 * Never includes tokens, bodies, or message content in classification output.
 */

function classifyGmailError(err) {
  if (!err || typeof err !== "object") return "transient";

  const status = err.response?.status;
  // Google error identifier, e.g. response.data.error = "invalid_grant"
  const reason =
    typeof err.response?.data?.error === "string"
      ? err.response.data.error
      : err.body?.error ?? err.message;

  if (status === 401) return "revoked";
  if (/invalid_grant|invalid_client|unauthorized/i.test(String(reason))) {
    return "revoked";
  }

  if (
    status === 429 ||
    status === 403 && /rateLimitExceeded|userRateLimitExceeded|quota/i.test(String(reason))
  ) {
    return "rate_limited";
  }

  if (status === 404 || status === 410) return "missing";

  // No HTTP response ⇒ network-level failure; 5xx ⇒ Google-side problem;
  // anything unrecognized is safest handled as retryable.
  return "transient";
}

/** True only when credentials are genuinely invalid/revoked. */
function isRevokedGmailError(err) {
  return classifyGmailError(err) === "revoked";
}

module.exports = { classifyGmailError, isRevokedGmailError };
