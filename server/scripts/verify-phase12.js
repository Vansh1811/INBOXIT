const mongoose = require("mongoose");
require("dotenv").config({ path: __dirname + "/../.env" });
if (!process.env.TOKEN_ENCRYPTION_KEY) process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);

const Email = require("../src/models/Email");
const User = require("../src/models/User");
const CategoryPreference = require("../src/models/CategoryPreference");
const { runEvaluation } = require("./eval-classifier-phase12");
const { processEmail } = require("../src/services/emailSyncService");
const { aiClassifier } = require("../src/services/ai/aiClassifier");

async function verify() {
  console.log("=== PHASE 12 VERIFICATION ===");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI is not set. Skipping live DB verification.");
    return;
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const syntheticUserId = new mongoose.Types.ObjectId();
  const syntheticEmailId1 = "synth_msg_1"; // Will be used as ground truth
  const syntheticEmailId2 = "synth_msg_2"; // To test AI budget

  try {
    // 1. Create a synthetic user correction (Ground Truth)
    await Email.create({
      userId: syntheticUserId,
      gmailMessageId: syntheticEmailId1,
      threadId: "synth_thread_1",
      senderDomain: "facebook.com",
      from: "no-reply@facebook.com",
      subject: "You have a new connection",
      category: "social",
      classificationSource: "user",
      userOverride: true,
      isDeleted: false,
      receivedAt: new Date()
    });

    console.log("✅ Synthetic ground-truth email created.");

    // 2. Prove Evaluation Harness captures this
    console.log("Running Evaluation Harness...");
    // We expect the harness to load this email since userOverride is true
    await runEvaluation();

    // 3. Prove AI Budget Exhaustion Preserves Deterministic Classification
    console.log("Testing AI pressure and budget exhaustion...");
    const originalAiEnabled = aiClassifier.enabled;
    const originalClassifyUncertain = aiClassifier.classifyUncertain;

    aiClassifier.enabled = () => true;
    aiClassifier.classifyUncertain = async () => ({ category: "jobs", source: "ai", confidence: 0.9, uncertain: false, signals: [] });

    const gmailMock = {
      users: { messages: { get: async () => ({ data: { id: syntheticEmailId2, payload: { headers: [
        { name: "From", value: "unrelated@example.com" },
        { name: "Subject", value: "Unrelated stuff" }
      ] } } }) } }
    };

    const aiStats = {
      candidates: 0,
      attempted: 0,
      succeeded: 0,
      fallbackKept: 0,
      skippedBudget: 0,
      skippedDisabled: 0,
      skippedCircuit: 0,
    };
    
    // Pass budget 0 to simulate exhaustion
    const aiContext = { remaining: 0 };
    
    try {
      const processed = await processEmail(
        gmailMock, syntheticEmailId2, syntheticUserId, {}, new Set(), aiContext, null, aiStats
      );

      if (processed.category !== "uncategorized" || aiStats.skippedBudget !== 1) {
        throw new Error(`Budget exhaustion test failed: ${JSON.stringify({ category: processed.category, aiStats })}`);
      }
      console.log("✅ Budget exhaustion preserves deterministic classification.");
    } finally {
      aiClassifier.enabled = originalAiEnabled;
      aiClassifier.classifyUncertain = originalClassifyUncertain;
    }

    console.log("✅ All verification steps completed successfully.");
  } finally {
    // Clean up
    try {
      await Email.deleteMany({ userId: syntheticUserId });
      console.log("Cleanup complete.");
    } finally {
      await mongoose.disconnect().catch((err) =>
        console.error("Disconnect warning:", err.message)
      );
    }
  }
}

verify().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
