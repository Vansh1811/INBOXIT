/**
 * Fail-fast environment validation.
 *
 * Runs before anything else in index.js so the process dies with a CLEAR
 * message instead of failing later in a confusing way (e.g. BullMQ workers
 * silently never starting, or tokens being written without an encryption key).
 */

const REQUIRED = [
  "JWT_SECRET",
  "MONGO_URI",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "CLIENT_URL",
  "TOKEN_ENCRYPTION_KEY",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_PASSWORD",
];

const OPTIONAL_WITH_WARNING = [
  {
    key: "PUBSUB_OIDC_AUDIENCE",
    message:
      "Gmail Pub/Sub webhook verification is DISABLED until this is set — " +
      "push notifications will be rejected. The 60s periodic polling " +
      "fallback remains active, so mail will still arrive (with up to a " +
      "minute of extra latency). To enable push, set this to the OIDC " +
      "configured on your Google Cloud Pub/Sub push subscription.",
  },
];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");

  if (missing.length) {
    console.error(
      `❌ Missing required environment variables: ${missing.join(", ")}\n` +
        `   Copy server/.env.example to server/.env and fill in real values.\n` +
        `   Generate TOKEN_ENCRYPTION_KEY with:\n` +
        `     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
    process.exit(1);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY)) {
    console.error(
      "❌ TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).\n" +
        '   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.exit(1);
  }

  // O-STEP8: AI fallback is an OPTIONAL feature — its absence must never
  // block startup, and its state must be visible at boot.
  console.log(
    `AI classification fallback: ${process.env.GEMINI_API_KEY ? "ENABLED" : "disabled (no GEMINI_API_KEY) — deterministic-only"}`
  );

  for (const { key, message } of OPTIONAL_WITH_WARNING) {
    if (!process.env[key]) {
      console.warn(`⚠️  ${key} not set — ${message}`);
    }
  }
}

module.exports = { validateEnv };
