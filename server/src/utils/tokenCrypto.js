const crypto = require("crypto");
const logger = require("../utils/logger").child({ component: "token-crypto" });

/**
 * Token encryption-at-rest utility.
 *
 * Format stored in MongoDB: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 *
 * Migration compatibility: any value WITHOUT the "v1:" prefix is treated as
 * legacy plaintext — decryptToken() passes it through unchanged, and it is
 * re-encrypted automatically the next time the field is written
 * (login / token refresh). No manual migration step is required.
 */

const PREFIX = "v1:";
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY;

if (!KEY_HEX || !/^[0-9a-fA-F]{64}$/.test(KEY_HEX)) {
  throw new Error(
    "TOKEN_ENCRYPTION_KEY is missing or invalid. Generate one with:\n" +
      '  node -e "logger.info(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      "and add it to server/.env"
  );
}

const KEY = Buffer.from(KEY_HEX, "hex");

function encryptToken(plain) {
  if (plain === null || plain === undefined || plain === "") return plain;
  if (typeof plain === "string" && plain.startsWith(PREFIX)) return plain; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptToken(stored) {
  if (!stored || typeof stored !== "string" || !stored.startsWith(PREFIX)) {
    // Legacy plaintext value (pre-encryption) — return as-is.
    return stored;
  }

  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !ctB64) return "";

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      KEY,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered data — fail closed rather than leaking garbage
    // that could be mistaken for a valid credential.
    logger.error("[TokenCrypto] ❌ Failed to decrypt a stored token (wrong key or corrupted data)");
    return "";
  }
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

module.exports = { encryptToken, decryptToken, isEncrypted };
