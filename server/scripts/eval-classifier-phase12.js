// scripts/eval-classifier-phase12.js
const mongoose = require("mongoose");
require("dotenv").config({ path: __dirname + "/../.env" });
if (!process.env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
const Email = require("../src/models/Email");
const { classifyDetailed } = require("../src/services/classifier");
const { 
  evaluateCategoryHistory, 
  applyContext, 
  combineEvaluations, 
  CONTEXT_ELIGIBLE_MAX_CONFIDENCE 
} = require("../src/services/contextPolicy");
const { createBatchedContextLoader } = require("../src/services/contextResolver");
const { calculateMetrics } = require("../src/services/evaluationPolicy");

const DEFAULT_SAMPLE_LIMIT = 1000;
const requestedSampleLimit = Number.parseInt(process.env.EVAL_SAMPLE_LIMIT || "", 10);
const SAMPLE_LIMIT = Number.isSafeInteger(requestedSampleLimit) && requestedSampleLimit > 0
  ? requestedSampleLimit
  : DEFAULT_SAMPLE_LIMIT;

async function runEvaluation() {
  console.log("=== PHASE 12: CLASSIFIER EVALUATION ===");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log("MONGO_URI is not set. Skipping live DB evaluation (this is a local environment limitation, not a bug).");
    return;
  }

  let didConnect = false;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB.");
    didConnect = true;
  }

  try {
    // Ground truth definition: emails that the user manually corrected and are not deleted
    const groundTruthQuery = { userOverride: true, isDeleted: false };
    const totalEligible = await Email.countDocuments(groundTruthQuery);
    console.log(`Eligible ground-truth emails: ${totalEligible}`);

    const emails = await Email.find(groundTruthQuery)
      .sort({ receivedAt: -1 })
      .limit(SAMPLE_LIMIT)
      .select({
        _id: 1,
        userId: 1,
        category: 1,
        from: 1,
        subject: 1,
        labels: 1,
        senderDomain: 1,
        threadId: 1,
      })
      .lean();

    console.log(`Loaded ${emails.length} samples for evaluation.`);

    const samples = [];
    const contextLoaders = new Map();

    for (const email of emails) {
    // 1. Derive trusted label
    const groundTruthCategory = email.category;

    // 2. Production classifier in evaluation mode
    // LIMITATION: We omit userPrefs entirely. If we included the user's active preferences, 
    // it would trivially leak the answer because this specific email's correction contributed 
    // to that preference. By omitting it, we evaluate the raw rules + context engine.
    const userPrefs = {}; 
    const decision = classifyDetailed(email.from, email.subject, userPrefs, email.labels || []);
    
    // 3. Apply Context
    let finalDecision = decision;
    let wasUncertainBeforeContext = decision.uncertain;
    
    if (decision.confidence <= CONTEXT_ELIGIBLE_MAX_CONFIDENCE) {
      if (!contextLoaders.has(email.userId.toString())) {
        contextLoaders.set(email.userId.toString(), createBatchedContextLoader(email.userId.toString()));
      }
      const loader = contextLoaders.get(email.userId.toString());
      
      try {
        const { domainEntries, threadEntries } = await loader.resolve({
          senderDomain: email.senderDomain,
          threadId: email.threadId,
          excludeMongoId: email._id.toString() // LEAKAGE PREVENTION
        });
        
        const combined = combineEvaluations(
          evaluateCategoryHistory(domainEntries || []),
          evaluateCategoryHistory(threadEntries || [])
        );
        
        if (combined.evaluation) {
          finalDecision = applyContext(decision, combined.evaluation, combined.contextType);
        }
      } catch (err) {
        // Safe fallback
      }
    }

    // 4. Record hypothetical AI pressure
    // The production system triggers AI if uncertain && !preserveCategory && budget > 0 && enabled
    // We want to record what WOULD have triggered AI.
    const wouldTriggerAi = finalDecision.uncertain;

    samples.push({
      groundTruthCategory,
      predictedCategory: finalDecision.category,
      predictedSource: finalDecision.source,
      predictedConfidence: finalDecision.confidence,
      uncertain: finalDecision.uncertain,
      wasUncertainBeforeContext,
      wouldTriggerAi
    });
    }

    const metrics = calculateMetrics(samples, totalEligible);
  
    console.log("\n=== EVALUATION RESULTS ===");
    console.log(JSON.stringify(metrics, null, 2));
    console.log("==========================\n");
  } finally {
    // Do not close a connection owned by a caller such as verify-phase12.js.
    if (didConnect) await mongoose.disconnect();
  }
}

if (require.main === module) {
  runEvaluation().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runEvaluation };
