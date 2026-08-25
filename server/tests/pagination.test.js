/**
 * Pagination cursor codec tests — run with: npm run test:pagination
 * Pure unit tests; no MongoDB/Redis required.
 */

process.env.TOKEN_ENCRYPTION_KEY = Array.from({ length: 64 }, (_, i) =>
  (i % 16).toString(16)
).join("");
process.env.JWT_SECRET = "test-jwt-secret";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  encodeCursor,
  decodeCursor,
  keysetBoundary,
} = require("../src/utils/cursor");

const ID_A = "64b00000000000000000000a";

describe("cursor codec", () => {
  test("round-trips a valid cursor", () => {
    const ts = new Date("2026-08-01T12:34:56.789Z");
    const encoded = encodeCursor(ts, ID_A);
    const decoded = decodeCursor(encoded);

    assert.ok(decoded, "must decode");
    assert.strictEqual(decoded.receivedAt.toISOString(), ts.toISOString());
    assert.strictEqual(decoded.id, ID_A);
  });

  test("produces URL-safe output", () => {
    const encoded = encodeCursor(new Date(), ID_A);
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.ok(encoded.length < 200);
  });

  test("rejects garbage / tampered cursors", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "not-base64!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from('{"r":"nope"}').toString("base64url"),
      Buffer.from('{"r":"2026-01-01T00:00:00Z"}').toString("base64url"), // missing i
      Buffer.from('{"r":"2026-01-01T00:00:00Z","i":"ZZZ"}').toString("base64url"), // bad id
      Buffer.from('{"r":123,"i":"' + ID_A + '"}').toString("base64url"), // wrong type
      Buffer.from('{"r":"2026-01-01","i":"' + ID_A + '","admin":true}').toString("base64url") +
        "extra-junk",
      "x".repeat(600),
    ]) {
      assert.strictEqual(decodeCursor(bad), null, `expected null for: ${String(bad).slice(0, 40)}`);
    }
  });

  test("boundary clause seeks strictly past ties", () => {
    const ts = new Date("2026-05-05T05:05:05.000Z");
    const c = decodeCursor(encodeCursor(ts, ID_A));
    const clause = keysetBoundary(c);

    assert.deepStrictEqual(
      clause,
      {
        $or: [
          { receivedAt: { $lt: new Date(ts.getTime()) } },
          { receivedAt: { $eq: new Date(ts.getTime()) }, _id: { $lt: ID_A } },
        ],
      },
      "exact-timestamp records with larger _id must still appear on the next page"
    );
  });

  test("empty boundary for first page", () => {
    assert.deepStrictEqual(keysetBoundary(null), {});
    assert.deepStrictEqual(keysetBoundary(undefined), {});
  });
});
