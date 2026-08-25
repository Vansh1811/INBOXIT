/**
 * Security hardening tests — run with: npm run test:security
 * Uses Node's built-in test runner. No external test framework.
 *
 * NOTE: these are pure unit tests (crypto + token extraction + schema hooks);
 * they intentionally do NOT touch MongoDB/Redis unlike the older scripts.
 */

// Env must exist BEFORE modules under test are loaded.
process.env.TOKEN_ENCRYPTION_KEY = Array.from({ length: 64 }, (_, i) =>
  (i % 16).toString(16)
).join(""); // deterministic 64-hex test key
process.env.JWT_SECRET = "test-jwt-secret";

const { test, describe } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

describe("tokenCrypto", () => {
  const {
    encryptToken,
    decryptToken,
    isEncrypted,
  } = require("../src/utils/tokenCrypto");

  test("encrypts and decrypts round-trip", () => {
    const secret = "ya29.super-secret-access-token-value";
    const stored = encryptToken(secret);

    assert.ok(isEncrypted(stored), "stored value must be prefixed");
    assert.match(stored, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    assert.notStrictEqual(stored, secret, "ciphertext must differ from plaintext");
    assert.strictEqual(decryptToken(stored), secret);
  });

  test("uses a random IV (same input → different ciphertext)", () => {
    assert.notStrictEqual(encryptToken("abc"), encryptToken("abc"));
  });

  test("is idempotent for already-encrypted values", () => {
    const once = encryptToken("refresh-token-123");
    assert.strictEqual(encryptToken(once), once, "must not double-encrypt");
    assert.strictEqual(decryptToken(encryptToken(once)), "refresh-token-123");
  });

  test("legacy plaintext passes through untouched", () => {
    const legacy = "plaintext-refresh-token";
    assert.strictEqual(decryptToken(legacy), legacy, "decrypt: passthrough");
    assert.strictEqual(isEncrypted(legacy), false);
  });

  test("handles empty values", () => {
    assert.strictEqual(encryptToken(""), "");
    assert.strictEqual(encryptToken(null), null);
    assert.strictEqual(encryptToken(undefined), undefined);
    assert.strictEqual(decryptToken(""), "");
    assert.strictEqual(decryptToken(null), null);
  });

  test("tampered ciphertext fails closed (returns empty string)", () => {
    const stored = encryptToken("do-not-recover-me");
    const parts = stored.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff; // flip a bit
    parts[3] = ct.toString("base64");
    const tampered = parts.join(":");

    assert.strictEqual(decryptToken(tampered), "", "GCM auth must reject tampered data");
  });
});

describe("tokenCrypto module-load guard", () => {
  test("fails loudly when TOKEN_ENCRYPTION_KEY is missing/invalid", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    try {
      delete require.cache[require.resolve("../src/utils/tokenCrypto")];
      assert.throws(() => require("../src/utils/tokenCrypto"), /TOKEN_ENCRYPTION_KEY/);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = saved;
      delete require.cache[require.resolve("../src/utils/tokenCrypto")];
      require("../src/utils/tokenCrypto"); // restore clean instance
    }
  });
});

describe("User schema encrypt-at-rest hooks", () => {
  const User = require("../src/models/User");

  test("accessToken setter encrypts, getter decrypts", () => {
    const path = User.schema.path("accessToken");
    const stored = path.applySetters("ya29.plaintext-from-google");

    assert.match(String(stored), /^v1:/, "value persisted to Mongo must be ciphertext");
    assert.strictEqual(
      path.applyGetters(stored),
      "ya29.plaintext-from-google",
      "application code must receive plaintext"
    );
  });

  test("refreshToken setter encrypts, getter decrypts", () => {
    const path = User.schema.path("refreshToken");
    const stored = path.applySetters("1//legacy-refresh-token");

    assert.match(String(stored), /^v1:/);
    assert.strictEqual(path.applyGetters(stored), "1//legacy-refresh-token");
  });

  test("schema hooks never double-encrypt", () => {
    const path = User.schema.path("accessToken");
    const once = path.applySetters("token-x");
    const twice = path.applySetters(once);
    assert.strictEqual(once, twice);
    assert.strictEqual(path.applyGetters(twice), "token-x");
  });
});

describe("authRequest token extraction", () => {
  const {
    extractTokenFromRequest,
    extractTokenFromHandshake,
    verifyAuthToken,
  } = require("../src/utils/authRequest");

  test("extracts Bearer token", () => {
    const req = { headers: { authorization: "Bearer abc.def.ghi" } };
    assert.strictEqual(extractTokenFromRequest(req), "abc.def.ghi");
  });

  test("extracts HttpOnly cookie token", () => {
    const req = { headers: { cookie: "other=x; jwt=tok.from.cookie; more=y" } };
    assert.strictEqual(extractTokenFromRequest(req), "tok.from.cookie");
  });

  test("Bearer takes precedence over cookie", () => {
    const req = {
      headers: {
        authorization: "Bearer header-token",
        cookie: "jwt=cookie-token",
      },
    };
    assert.strictEqual(extractTokenFromRequest(req), "header-token");
  });

  test("returns null when nothing present", () => {
    assert.strictEqual(extractTokenFromRequest({ headers: {} }), null);
    assert.strictEqual(extractTokenFromHandshake({ headers: {} }), null);
  });

  test("handshake accepts cookie via headers", () => {
    const handshake = { headers: { cookie: "jwt=hs-cookie-token" }, auth: {} };
    assert.strictEqual(extractTokenFromHandshake(handshake), "hs-cookie-token");
  });

  test("verifyAuthToken validates real JWTs and rejects bad ones", () => {
    const good = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    const decoded = verifyAuthToken(good);
    assert.strictEqual(decoded.id, "user-123");

    assert.strictEqual(verifyAuthToken(null), null);
    assert.strictEqual(verifyAuthToken("not-a-jwt"), null);

    const expired = jwt.sign({ id: "u" }, process.env.JWT_SECRET, {
      expiresIn: "-10s",
    });
    assert.strictEqual(verifyAuthToken(expired), null);

    const wrongSecret = jwt.sign({ id: "u" }, "other-secret");
    assert.strictEqual(verifyAuthToken(wrongSecret), null);
  });
});
