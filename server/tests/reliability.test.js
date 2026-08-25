/**
 * Reliability regression tests — run with: npm run test:reliability
 * Pure unit tests; no MongoDB/Redis/Gmail required.
 *
 * Covers:
 *   - O-C1: restrictRollbackToFailed (partial bulk failure rollback scoping)
 *   - resolveRollbackIds contract incl. legacy Phase 2 payload compat
 */

process.env.TOKEN_ENCRYPTION_KEY = Array.from({ length: 64 }, (_, i) =>
  (i % 16).toString(16)
).join("");
process.env.JWT_SECRET = "test-jwt-secret";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  resolveRollbackIds,
  restrictRollbackToFailed,
} = require("../src/utils/actionRollback");
const {
  shouldAdvanceCursor,
  POISON_WINDOW_RUNS,
} = require("../src/utils/syncPolicy");
const {
  classifyGmailError,
  isRevokedGmailError,
} = require("../src/utils/gmailErrors");

const UID = "64b00000000000000000000u".replace("u", "1");

describe("classifyGmailError (O-H3)", () => {
  const httpErr = (status, bodyError) => ({
    response: { status, data: bodyError !== undefined ? { error: bodyError } : {} },
    message: `status ${status}`,
  });

  test("401 → revoked", () => {
    assert.strictEqual(classifyGmailError(httpErr(401)), "revoked");
  });

  test("invalid_grant on the token endpoint → revoked", () => {
    assert.strictEqual(
      classifyGmailError(httpErr(400, "invalid_grant")),
      "revoked"
    );
  });

  test("429 and rateLimitExceeded → rate_limited", () => {
    assert.strictEqual(classifyGmailError(httpErr(429)), "rate_limited");
    assert.strictEqual(
      classifyGmailError(httpErr(403, "rateLimitExceeded")),
      "rate_limited"
    );
  });

  test("403 without a quota reason → transient (not revoked!)", () => {
    // e.g. forbidden-scope errors must NOT stop polling / force logout
    assert.strictEqual(classifyGmailError(httpErr(403, "forbidden")), "transient");
  });

  test("404/410 → missing", () => {
    assert.strictEqual(classifyGmailError(httpErr(404)), "missing");
    assert.strictEqual(classifyGmailError(httpErr(410)), "missing");
  });

  test("Google 5xx → transient", () => {
    assert.strictEqual(classifyGmailError(httpErr(500)), "transient");
    assert.strictEqual(classifyGmailError(httpErr(503)), "transient");
  });

  test("network failures (no response) → transient", () => {
    assert.strictEqual(classifyGmailError(new Error("ECONNRESET")), "transient");
    assert.strictEqual(classifyGmailError(undefined), "transient");
  });

  test("isRevokedGmailError agrees with classification", () => {
    assert.strictEqual(isRevokedGmailError(httpErr(401)), true);
    assert.strictEqual(isRevokedGmailError(httpErr(500)), false);
  });
});

describe("shouldAdvanceCursor (O-H1 history-cursor policy)", () => {
  test("clean run advances and resets the streak", () => {
    const out = shouldAdvanceCursor({ errors: 0, previousErroredRuns: 2 });
    assert.deepStrictEqual(out, { advance: true, gaveUp: false, newStreak: 0 });
  });

  test("errored run under the cap RETAINS the cursor", () => {
    for (let prev = 0; prev < POISON_WINDOW_RUNS - 1; prev++) {
      const out = shouldAdvanceCursor({ errors: 2, previousErroredRuns: prev });
      assert.strictEqual(out.advance, false, `streak ${prev + 1} must retain cursor`);
      assert.strictEqual(out.gaveUp, false);
      assert.strictEqual(out.newStreak, prev + 1);
    }
  });

  test("poison cap reached → advance anyway and reset (gaveUp=true)", () => {
    const out = shouldAdvanceCursor({
      errors: 5,
      previousErroredRuns: POISON_WINDOW_RUNS - 1,
    });
    assert.strictEqual(out.advance, true);
    assert.strictEqual(out.gaveUp, true);
    assert.strictEqual(out.newStreak, 0);
  });

  test("default inputs behave as a clean run", () => {
    assert.deepStrictEqual(shouldAdvanceCursor(), {
      advance: true, gaveUp: false, newStreak: 0,
    });
  });
});

describe("restrictRollbackToFailed (O-C1)", () => {
  const snapshot = {
    userId: UID,
    action: "bulk-trash",
    restoreNotDeletedIds: ["a1", "a2", "a3"],
    restoreInboxIds: [],
  };

  test("keeps ONLY failed ids in a snapshot payload", () => {
    const out = restrictRollbackToFailed(snapshot, ["a1", "a3"]);
    assert.deepStrictEqual(out.restoreNotDeletedIds.sort(), ["a1", "a3"]);
    assert.strictEqual(out.userId, UID);
    assert.strictEqual(out.action, "bulk-trash");
  });

  test("archive snapshots filter restoreInboxIds independently", () => {
    const arch = {
      userId: UID,
      action: "bulk-archive",
      restoreInboxIds: ["b1", "b2"],
      restoreNotDeletedIds: [],
    };
    const out = restrictRollbackToFailed(arch, ["b2"]);
    assert.deepStrictEqual(out.restoreInboxIds, ["b2"]);
    assert.deepStrictEqual(out.restoreNotDeletedIds, []);
  });

  test("legacy mongoIds payloads are filtered too", () => {
    const legacy = { userId: UID, action: "bulk-delete", mongoIds: ["c1", "c2"] };
    const out = restrictRollbackToFailed(legacy, ["c2"]);
    assert.deepStrictEqual(out.mongoIds, ["c2"]);
  });

  test("returns null when nothing failed (job truly succeeded)", () => {
    assert.strictEqual(restrictRollbackToFailed(snapshot, []), null);
    assert.strictEqual(restrictRollbackToFailed(snapshot, undefined), null);
  });

  test("failed ids absent from snapshot yield an empty (no-op) payload", () => {
    // Docs deleted between enqueue and failure ⇒ nothing restorable.
    // MUST NOT be null: null would make the worker fall back to the FULL
    // snapshot and wrongly revert successfully-mutated ids.
    const out = restrictRollbackToFailed(snapshot, ["zz9"]);
    assert.deepStrictEqual(out.restoreInboxIds, []);
    assert.deepStrictEqual(out.restoreNotDeletedIds, []);
  });

  test("restricted payload can never widen scope beyond original snapshot", () => {
    const narrow = {
      userId: UID,
      action: "bulk-archive",
      restoreInboxIds: [], // originally NOT in inbox → nothing restorable
      restoreNotDeletedIds: ["d1"],
    };
    const out = restrictRollbackToFailed(narrow, ["d1", "intruder-id"]);
    assert.deepStrictEqual(out.restoreInboxIds, []);
    assert.deepStrictEqual(out.restoreNotDeletedIds, ["d1"]);
  });
});

describe("resolveRollbackIds (contract)", () => {
  test("snapshot payload routes by action family", () => {
    const del = resolveRollbackIds({
      userId: UID, action: "delete", restoreNotDeletedIds: ["x"],
    });
    assert.deepStrictEqual(del.notDeletedIds, ["x"]);
    assert.deepStrictEqual(del.archiveIds, []);

    const arch = resolveRollbackIds({
      userId: UID, action: "bulk-archive", restoreInboxIds: ["y"],
    });
    assert.deepStrictEqual(arch.archiveIds, ["y"]);
    assert.deepStrictEqual(arch.notDeletedIds, []);
  });

  test("legacy mongoIds fall back per action family", () => {
    const del = resolveRollbackIds({ userId: UID, action: "delete", mongoIds: ["m1"] });
    assert.deepStrictEqual(del.notDeletedIds, ["m1"]);

    const arch = resolveRollbackIds({ userId: UID, action: "bulk-archive", mongoIds: ["m2"] });
    assert.deepStrictEqual(arch.archiveIds, ["m2"]);
  });

  test("bare emailId acts as single-item fallback", () => {
    const out = resolveRollbackIds({ userId: UID, action: "archive", emailId: "solo" });
    assert.deepStrictEqual(out.archiveIds, ["solo"]);
  });

  test("no metadata anywhere → empty arrays (silent-safe)", () => {
    const out = resolveRollbackIds({ userId: UID, action: "delete" });
    assert.deepStrictEqual(out.archiveIds, []);
    assert.deepStrictEqual(out.notDeletedIds, []);
  });
});
