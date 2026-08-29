const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
require("dotenv").config({ path: __dirname + "/../.env" });
if (!process.env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
const { calculateMetrics, getConfidenceBand } = require("../src/services/evaluationPolicy");
const { classifyDetailed } = require("../src/services/classifier");
const { runSync, processEmail } = require("../src/services/emailSyncService");
const { aiClassifier } = require("../src/services/ai/aiClassifier");

describe("Phase 12: Evaluation Metrics", () => {
  it("computes perfect accuracy", () => {
    const metrics = calculateMetrics([
      { groundTruthCategory: "jobs", predictedCategory: "jobs", predictedSource: "rule", predictedConfidence: 0.9, uncertain: false },
      { groundTruthCategory: "social", predictedCategory: "social", predictedSource: "rule", predictedConfidence: 0.85, uncertain: false },
    ], 2);
    assert.strictEqual(metrics.accuracy, 1);
    assert.strictEqual(metrics.coverage, 1);
  });

  it("handles zero samples safely", () => {
    const metrics = calculateMetrics([], 0);
    assert.strictEqual(metrics.evaluated, 0);
    assert.strictEqual(metrics.accuracy, null);
    assert.strictEqual(metrics.coverage, null);
  });

  it("treats untrusted metric labels as data, not object prototype keys", () => {
    delete Object.prototype.phase12Polluted;
    const metrics = calculateMetrics([
      {
        groundTruthCategory: "__proto__",
        predictedCategory: "__proto__",
        predictedSource: "__proto__",
        predictedConfidence: Number.NaN,
        uncertain: false,
      },
    ]);

    assert.strictEqual(Object.prototype.phase12Polluted, undefined);
    assert.strictEqual(metrics.accuracy, 0);
    assert.strictEqual(metrics.confusionMatrix["<invalid>"]["<invalid>"], 1);
    assert.strictEqual(metrics.sourceAccuracy["__proto__"], 0);
    assert.strictEqual(metrics.confidenceAccuracy.unknown, 0);
    delete Object.prototype.phase12Polluted;
  });

  it("computes mixed predictions and confusion matrix", () => {
    const metrics = calculateMetrics([
      { groundTruthCategory: "jobs", predictedCategory: "jobs", predictedSource: "rule", predictedConfidence: 0.9, uncertain: false },
      { groundTruthCategory: "jobs", predictedCategory: "social", predictedSource: "rule", predictedConfidence: 0.85, uncertain: false }, // incorrect
    ], 4);
    assert.strictEqual(metrics.accuracy, 0.5);
    assert.strictEqual(metrics.coverage, 0.5); // 2 evaluated out of 4 eligible
    assert.strictEqual(metrics.confusionMatrix.jobs.jobs, 1);
    assert.strictEqual(metrics.confusionMatrix.jobs.social, 1);
  });

  it("computes confidence bands correctly", () => {
    assert.strictEqual(getConfidenceBand(0.95), "0.90-1.00");
    assert.strictEqual(getConfidenceBand(0.85), "0.80-0.89");
    assert.strictEqual(getConfidenceBand(0.7), "0.70-0.79");
    assert.strictEqual(getConfidenceBand(0.6), "0.60-0.69");
    assert.strictEqual(getConfidenceBand(0.5), "0.00-0.59");
    assert.strictEqual(getConfidenceBand(null), "unknown");
  });
});

describe("Phase 12: Evaluation Safety & Leakage Prevention", () => {
  it("does not mutate classifier preference input during pure evaluation", () => {
    const userPrefs = Object.freeze({});
    const decision = classifyDetailed("no-reply@facebook.com", "You have a new connection", userPrefs, []);
    assert.strictEqual(decision.source, "rule");
    assert.strictEqual(decision.category, "social");
  });
});

describe("Phase 12: AI Cost Controls", () => {
  let originalAiEnabled;
  let originalClassifyUncertain;

  beforeEach(() => {
    originalAiEnabled = aiClassifier.enabled;
    originalClassifyUncertain = aiClassifier.classifyUncertain;
  });

  afterEach(() => {
    aiClassifier.enabled = originalAiEnabled;
    aiClassifier.classifyUncertain = originalClassifyUncertain;
  });

  it("tracks aiStats counters accurately", async () => {
    const gmail = { users: { messages: { get: async () => ({ data: { payload: { headers: [] } } }) } } };
    aiClassifier.enabled = () => true;
    aiClassifier.classifyUncertain = async () => ({ category: "jobs", source: "ai", confidence: 0.9, uncertain: false, signals: [] });

    const aiStats = {
      candidates: 0,
      attempted: 0,
      succeeded: 0,
      fallbackKept: 0,
      skippedBudget: 0,
      skippedDisabled: 0,
      skippedCircuit: 0,
    };
    const aiContext = { remaining: 10 };

    await processEmail(gmail, "msg1", "user1", {}, new Map(), aiContext, null, aiStats);

    assert.strictEqual(aiStats.candidates, 1);
    assert.strictEqual(aiStats.attempted, 1);
    assert.strictEqual(aiStats.succeeded, 1);
    assert.strictEqual(aiContext.remaining, 9);
  });

  it("skips budget when exhausted", async () => {
    const gmail = { users: { messages: { get: async () => ({ data: { payload: { headers: [] } } }) } } };
    aiClassifier.enabled = () => true;

    const aiStats = {
      candidates: 0,
      attempted: 0,
      succeeded: 0,
      fallbackKept: 0,
      skippedBudget: 0,
      skippedDisabled: 0,
      skippedCircuit: 0,
    };
    const aiContext = { remaining: 0 }; // Budget exhausted

    await processEmail(gmail, "msg1", "user1", {}, new Map(), aiContext, null, aiStats);

    assert.strictEqual(aiStats.candidates, 1);
    assert.strictEqual(aiStats.attempted, 0);
    assert.strictEqual(aiStats.skippedBudget, 1);
    assert.strictEqual(aiContext.remaining, 0);
  });
});
