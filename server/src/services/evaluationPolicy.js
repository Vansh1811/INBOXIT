/**
 * Pure metrics module for evaluating classifier correctness against ground truth.
 * Percentage calculations are bounded [0, 1] and handle zero denominators by returning null.
 */

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const { isValidCategory } = require("./categories");
const INVALID_CATEGORY = "<invalid>";

// Metric labels ultimately come from persisted/untrusted data. Keep counters
// on null-prototype maps so labels such as "__proto__" cannot alter globals.
const createCounterMap = () => Object.create(null);
const setOwn = (object, key, value) => {
  Object.defineProperty(object, String(key), {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
};

const copyCounts = (counts) => {
  const result = {};
  for (const [key, value] of Object.entries(counts)) setOwn(result, key, value);
  return result;
};

const copyConfusionMatrix = (matrix) => {
  const result = {};
  for (const [truth, predictions] of Object.entries(matrix)) {
    const row = {};
    for (const [prediction, count] of Object.entries(predictions)) {
      setOwn(row, prediction, count);
    }
    setOwn(result, truth, row);
  }
  return result;
};

const metricCategory = (value) => isValidCategory(value) ? value : INVALID_CATEGORY;

function calculateMetrics(samples, totalEligible = null) {
  const rows = Array.isArray(samples) ? samples : [];
  const total = rows.length;
  const eligible = Number.isFinite(totalEligible) && totalEligible >= 0
    ? totalEligible
    : total;
  if (total === 0) return { 
    evaluated: 0,
    eligible,
    accuracy: null, 
    coverage: null, 
    uncertainCount: 0, 
    uncertainRate: null,
    confusionMatrix: {},
    sourceAccuracy: {},
    confidenceAccuracy: {},
    aiPressure: {
      aiEligibleCount: 0,
      aiEligibleRate: null,
      contextRefinedCertain: 0,
      contextRefinedStillUncertain: 0,
      certainBeforeContext: 0
    }
  };

  let correct = 0;
  let uncertainCount = 0;
  const confusionMatrix = createCounterMap();
  const sourceStats = createCounterMap();
  const confidenceStats = createCounterMap();

  let aiEligibleCount = 0;
  let contextRefinedCertain = 0;
  let contextRefinedStillUncertain = 0;
  let certainBeforeContext = 0;

  for (const rawSample of rows) {
    const s = rawSample && typeof rawSample === "object" ? rawSample : {};
    const groundTruthValid = isValidCategory(s.groundTruthCategory);
    const predictedValid = isValidCategory(s.predictedCategory);
    if (groundTruthValid && predictedValid && s.predictedCategory === s.groundTruthCategory) correct++;
    if (s.uncertain) uncertainCount++;

    // Confusion Matrix
    const truth = metricCategory(s.groundTruthCategory);
    const prediction = metricCategory(s.predictedCategory);
    if (!hasOwn(confusionMatrix, truth)) {
      confusionMatrix[truth] = createCounterMap();
    }
    const row = confusionMatrix[truth];
    row[prediction] = (row[prediction] || 0) + 1;

    // Source Stats
    const source = String(s.predictedSource);
    if (!hasOwn(sourceStats, source)) {
      sourceStats[source] = { total: 0, correct: 0 };
    }
    sourceStats[source].total++;
    if (groundTruthValid && predictedValid && s.predictedCategory === s.groundTruthCategory) {
      sourceStats[source].correct++;
    }

    // Confidence Band
    const band = getConfidenceBand(s.predictedConfidence);
    if (!confidenceStats[band]) {
      confidenceStats[band] = { total: 0, correct: 0 };
    }
    confidenceStats[band].total++;
    if (groundTruthValid && predictedValid && s.predictedCategory === s.groundTruthCategory) {
      confidenceStats[band].correct++;
    }

    // AI Pressure Tracking
    if (s.wouldTriggerAi) aiEligibleCount++;
    if (s.wasUncertainBeforeContext && !s.uncertain) contextRefinedCertain++;
    if (s.wasUncertainBeforeContext && s.uncertain) contextRefinedStillUncertain++;
    if (!s.wasUncertainBeforeContext) certainBeforeContext++;
  }

  return {
    evaluated: total,
    eligible,
    accuracy: correct / total,
    coverage: eligible > 0 && total <= eligible ? total / eligible : null,
    uncertainCount,
    uncertainRate: uncertainCount / total,
    confusionMatrix: copyConfusionMatrix(confusionMatrix),
    sourceAccuracy: copyCounts(Object.entries(sourceStats).reduce((acc, [source, stats]) => {
      acc[source] = stats.correct / stats.total;
      return acc;
    }, createCounterMap())),
    confidenceAccuracy: copyCounts(Object.entries(confidenceStats).reduce((acc, [band, stats]) => {
      acc[band] = stats.correct / stats.total;
      return acc;
    }, createCounterMap())),
    aiPressure: {
      aiEligibleCount,
      aiEligibleRate: aiEligibleCount / total,
      contextRefinedCertain,
      contextRefinedStillUncertain,
      certainBeforeContext
    }
  };
}

function getConfidenceBand(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unknown';
  if (confidence >= 0.9) return '0.90-1.00';
  if (confidence >= 0.8) return '0.80-0.89';
  if (confidence >= 0.7) return '0.70-0.79';
  if (confidence >= 0.6) return '0.60-0.69';
  return '0.00-0.59';
}

module.exports = {
  calculateMetrics,
  getConfidenceBand
};
