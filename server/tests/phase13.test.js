/**
 * Phase 13 - production AI reliability tests.
 *
 * These tests use injected fake providers only. They do not require API keys,
 * network access, MongoDB, or Redis.
 */
process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.JWT_SECRET = "phase13-test-secret";

const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { google } = require("googleapis");

const {
  createAIClassifierService,
  aiClassifier,
} = require("../src/services/ai/aiClassifier");
const { buildAiSummary } = require("../src/services/ai/aiTelemetry");
const { processEmail, runSync } = require("../src/services/emailSyncService");

const UNCERTAIN_REQUEST = {
  fromDomain: "unknown-corp.example",
  subject: "please review this message",
  snippet: "an otherwise unclassified message",
};

function fakeService(providerFn, { enabled = true } = {}) {
  const calls = [];
  const svc = createAIClassifierService({
    provider: async (request) => {
      calls.push(request);
      return providerFn(request);
    },
    providerName: "fake",
    apiKeyGetter: () => "fake-api-key",
    isEnabled: () => enabled,
    model: "fake-model",
  });
  return { svc, calls };
}

function fakeGmailMessage(id = "message-1") {
  return {
    users: {
      messages: {
        get: async () => ({
          data: {
            id,
            threadId: "thread-1",
            snippet: "unclassified message",
            labelIds: [],
            payload: {
              headers: [
                { name: "From", value: "Unknown Sender <unknown-corp.example>" },
                { name: "To", value: "me@example.com" },
                { name: "Subject", value: "qzx" },
              ],
            },
          },
        }),
      },
    },
  };
}

const zeroAiStats = () => ({
  eligible: 0,
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  budgetExhausted: 0,
  skippedDisabled: 0,
  skippedCircuitOpen: 0,
});

describe("Phase 13: AI operational status", () => {
  test("reports disabled state and never invokes the provider", async () => {
    const { svc, calls } = fakeService(() => "not-called", { enabled: false });

    const result = await svc.classifyUncertain(UNCERTAIN_REQUEST);
    const status = svc.getOperationalStatus();

    assert.deepEqual(result, { skipped: true, reason: "disabled" });
    assert.equal(calls.length, 0);
    assert.equal(status.scope, "process");
    assert.equal(status.enabled, false);
    assert.equal(status.provider, "fake");
    assert.equal(status.model, "fake-model");
    assert.equal(status.circuitState, "closed");
    assert.equal(status.retryEligible, true);
    assert.equal(status.skippedDisabled, 1);
    assert.equal(status.skippedCircuitOpen, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(status, "apiKey"), false);
  });

  test("reports successful attempts without exposing request data", async () => {
    const { svc, calls } = fakeService(
      () => '{"category":"finance","confidence":0.84}'
    );

    const result = await svc.classifyUncertain(UNCERTAIN_REQUEST);
    const status = svc.getOperationalStatus();

    assert.equal(result.category, "finance");
    assert.equal(status.attempts, 1);
    assert.equal(status.successes, 1);
    assert.equal(status.failures, 0);
    assert.equal(status.circuitState, "closed");
    assert.equal(calls[0].apiKey, "fake-api-key");
    assert.equal(Object.prototype.hasOwnProperty.call(status, "subject"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(status, "snippet"), false);
  });

  test("classifies failures into timeout, malformed, rate-limit, HTTP, and network buckets", async () => {
    const cases = [
      {
        name: "timeout",
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        bucket: "timeout",
      },
      {
        name: "rate limit",
        error: Object.assign(new Error("slow down"), { response: { status: 429 } }),
        bucket: "rateLimited",
      },
      {
        name: "HTTP",
        error: Object.assign(new Error("provider unavailable"), { response: { status: 503 } }),
        bucket: "http",
      },
      {
        name: "network",
        error: new Error("socket hang up"),
        bucket: "network",
      },
    ];

    for (const item of cases) {
      const { svc } = fakeService(() => { throw item.error; });
      assert.equal(await svc.classifyUncertain(UNCERTAIN_REQUEST), null, item.name);
      const status = svc.getOperationalStatus();
      assert.equal(status.failures, 1, item.name);
      assert.equal(status.failureCategories[item.bucket], 1, item.name);
      assert.match(status.lastFailureAt, /^\d{4}-\d{2}-\d{2}T/);
    }

    const { svc: malformedService } = fakeService(() => "not JSON");
    assert.equal(await malformedService.classifyUncertain(UNCERTAIN_REQUEST), null);
    const malformedStatus = malformedService.getOperationalStatus();
    assert.equal(malformedStatus.failures, 1);
    assert.equal(malformedStatus.failureCategories.malformed, 1);
    assert.equal(malformedStatus.lastFailureKind, "malformed");
  });

  test("opens the circuit after consecutive failures and skips without calling the provider", async () => {
    const { svc, calls } = fakeService(() => { throw new Error("provider down"); });

    await svc.classifyUncertain(UNCERTAIN_REQUEST);
    await svc.classifyUncertain(UNCERTAIN_REQUEST);
    await svc.classifyUncertain(UNCERTAIN_REQUEST);
    const opened = svc.getOperationalStatus();

    assert.equal(opened.circuitState, "open");
    assert.equal(opened.circuitOpen, true);
    assert.equal(opened.consecutiveFailures, 3);
    assert.equal(opened.retryEligible, false);
    assert.ok(opened.cooldownRemainingMs > 0);

    const result = await svc.classifyUncertain(UNCERTAIN_REQUEST);
    const skipped = svc.getOperationalStatus();
    assert.deepEqual(result, { skipped: true, reason: "circuit_open" });
    assert.equal(calls.length, 3);
    assert.equal(skipped.skippedCircuitOpen, 1);
  });

  test("transitions through half-open state and records recovery", async () => {
    let shouldFail = true;
    const { svc } = fakeService(() => {
      if (shouldFail) throw new Error("temporary outage");
      return '{"category":"personal","confidence":0.7}';
    });

    for (let i = 0; i < 3; i += 1) {
      await svc.classifyUncertain(UNCERTAIN_REQUEST);
    }
    svc.__forceCooldownElapsed();
    const halfOpen = svc.getOperationalStatus();
    assert.equal(halfOpen.circuitState, "half_open");
    assert.equal(halfOpen.retryEligible, true);

    shouldFail = false;
    const result = await svc.classifyUncertain(UNCERTAIN_REQUEST);
    const recovered = svc.getOperationalStatus();
    assert.equal(result.category, "personal");
    assert.equal(recovered.circuitState, "closed");
    assert.equal(recovered.consecutiveFailures, 0);
    assert.equal(recovered.recoveries, 1);
    assert.match(recovered.lastRecoveryAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("reset clears counters and circuit state", async () => {
    const { svc } = fakeService(() => { throw new Error("provider down"); });
    await svc.classifyUncertain(UNCERTAIN_REQUEST);
    svc.__reset();

    const status = svc.getOperationalStatus();
    assert.equal(status.attempts, 0);
    assert.equal(status.successes, 0);
    assert.equal(status.failures, 0);
    assert.equal(status.skipped, 0);
    assert.equal(status.consecutiveFailures, 0);
    assert.equal(status.circuitState, "closed");
    assert.equal(status.lastFailureAt, null);
    assert.equal(status.lastRecoveryAt, null);
  });
});

describe("Phase 13: safe telemetry", () => {
  test("allow-lists and bounds the worker AI summary", () => {
    const summary = buildAiSummary(
      {
        eligible: 2,
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 1,
        budgetExhausted: 1,
        skippedDisabled: 0,
        skippedCircuitOpen: 0,
        subject: "secret subject",
        rawProviderOutput: "secret output",
      },
      {
        enabled: true,
        provider: "fake",
        model: "test-model",
        circuitState: "open",
        circuitOpen: true,
        consecutiveFailures: 3,
        cooldownRemainingMs: 999999999,
        retryEligible: false,
        recoveries: 2,
        attempts: 4,
        successes: 1,
        failures: 3,
        skipped: 5,
        failureCategories: {
          timeout: 1,
          malformed: 1,
          rateLimited: 1,
          http: 0,
          network: 0,
        },
        apiKey: "secret-api-key",
        userId: "secret-user",
      }
    );

    assert.equal(summary.scope, "process");
    assert.equal(summary.cooldownRemainingMs, 86_400_000);
    assert.deepEqual(summary.sync, {
      eligible: 2,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      skipped: 1,
      budgetExhausted: 1,
      skippedDisabled: 0,
      skippedCircuitOpen: 0,
    });
    assert.deepEqual(summary.process.failureCategories, {
      timeout: 1,
      malformed: 1,
      rateLimited: 1,
      http: 0,
      network: 0,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(summary, "apiKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, "userId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(summary.sync, "subject"), false);
  });
});

describe("Phase 13: per-sync accounting and isolation", () => {
  let originalEnabled;
  let originalClassify;

  beforeEach(() => {
    originalEnabled = aiClassifier.enabled;
    originalClassify = aiClassifier.classifyUncertain;
  });

  afterEach(() => {
    aiClassifier.enabled = originalEnabled;
    aiClassifier.classifyUncertain = originalClassify;
  });

  test("counts an AI success without changing the per-run budget contract", async () => {
    const stats = zeroAiStats();
    const context = { remaining: 10 };
    aiClassifier.enabled = () => true;
    aiClassifier.classifyUncertain = async () => ({
      category: "jobs",
      source: "ai",
      confidence: 0.9,
      uncertain: false,
      signals: [],
    });

    const result = await processEmail(
      fakeGmailMessage(),
      "message-1",
      "user-1",
      {},
      new Set(),
      context,
      null,
      stats
    );

    assert.equal(result.classificationSource, "ai");
    assert.deepEqual(stats, {
      eligible: 1,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      budgetExhausted: 0,
      skippedDisabled: 0,
      skippedCircuitOpen: 0,
    });
    assert.equal(context.remaining, 9);
  });

  test("records disabled, budget, circuit, and provider-fallback outcomes", async () => {
    const cases = [
      {
        name: "disabled",
        enabled: false,
        response: null,
        expected: { skipped: 1, skippedDisabled: 1 },
      },
      {
        name: "budget",
        enabled: true,
        response: null,
        remaining: 0,
        expected: { skipped: 1, budgetExhausted: 1 },
      },
      {
        name: "circuit",
        enabled: true,
        response: { skipped: true, reason: "circuit_open" },
        expected: { attempted: 0, skipped: 1, skippedCircuitOpen: 1 },
      },
      {
        name: "provider failure",
        enabled: true,
        response: null,
        expected: { attempted: 1, failed: 1 },
      },
    ];

    for (const item of cases) {
      const stats = zeroAiStats();
      const context = { remaining: item.remaining ?? 10 };
      aiClassifier.enabled = () => item.enabled;
      aiClassifier.classifyUncertain = async () => item.response;

      await processEmail(
        fakeGmailMessage(`message-${item.name}`),
        `message-${item.name}`,
        "user-1",
        {},
        new Set(),
        context,
        null,
        stats
      );

      assert.equal(stats.eligible, 1, item.name);
      for (const [field, value] of Object.entries(item.expected)) {
        assert.equal(stats[field], value, item.name);
      }
    }
  });

  test("contains an unexpected AI exception and keeps deterministic ingestion", async () => {
    const stats = zeroAiStats();
    aiClassifier.enabled = () => true;
    aiClassifier.classifyUncertain = async () => {
      throw new Error("unexpected AI seam failure");
    };

    const result = await processEmail(
      fakeGmailMessage(),
      "message-1",
      "user-1",
      {},
      new Set(),
      { remaining: 10 },
      null,
      stats
    );

    assert.equal(result.category, "uncategorized");
    assert.equal(result.classificationSource, "default");
    assert.equal(stats.attempted, 1);
    assert.equal(stats.failed, 1);
  });
});

describe("Phase 13: empty sync accounting", () => {
  let originalGmail;

  beforeEach(() => {
    originalGmail = google.gmail;
  });

  afterEach(() => {
    google.gmail = originalGmail;
  });

  test("returns fresh zeroed AI stats for an empty run", async () => {
    google.gmail = () => ({
      users: {
        messages: {
          list: async () => ({ data: { messages: [] } }),
        },
        getProfile: async () => ({ data: { historyId: "history-2" } }),
      },
    });

    const user = {
      _id: "user-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
      syncState: { totalSynced: 4, erroredRuns: 2 },
    };

    const first = await runSync({ user, syncType: "full" });
    first.aiStats.eligible = 99;
    const second = await runSync({ user, syncType: "full" });

    assert.deepEqual(second.aiStats, zeroAiStats());
    assert.notStrictEqual(first.aiStats, second.aiStats);
    assert.equal(second.isEmpty, true);
    assert.equal(second.totalSynced, 4);
  });
});
