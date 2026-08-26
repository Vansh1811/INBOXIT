/**
 * Phase 8 — READ-ONLY classifier evaluation against the live database.
 *
 * Produces distribution/conflict statistics ONLY:
 *   - category distribution
 *   - classification-source distribution (post-Phase-8 field)
 *   - rule-vs-stored drift on a bounded recent sample
 *   - weak-match (subject-only) rate = future AI-fallback pressure estimate
 *
 * Prints no subjects, snippets, or bodies. Performs ZERO writes.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { classifyDetailed } = require("../src/services/classifier");

const SAMPLE_LIMIT = 500;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const coll = mongoose.connection.db.collection("emails");

  const total = await coll.countDocuments({});
  console.log(`Total documents: ${total}`);

  const byCategory = await coll.aggregate([
    { $group: { _id: "$category", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  console.log("\nCategory distribution:");
  for (const r of byCategory) console.log(`  ${r._id ?? "<none>"}: ${r.n}`);

  const bySource = await coll.aggregate([
    { $group: { _id: "$classificationSource", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  console.log("\nClassification-source distribution:");
  for (const r of bySource) console.log(`  ${r._id ?? "<legacy/unknown>"}: ${r.n}`);

  // Bounded recent sample — recompute with the CURRENT classifier
  const sample = await coll.find(
    {},
    { projection: { from: 1, subject: 1, labels: 1, category: 1 }, sort: { receivedAt: -1 }, limit: SAMPLE_LIMIT }
  ).toArray();

  let weakRule = 0, tabOnly = 0, defaultHit = 0, drifted = 0, checked = 0;
  const driftByCategory = {};
  for (const doc of sample) {
    checked++;
    const d = classifyDetailed(
      doc.from || "", doc.subject || "", {},
      Array.isArray(doc.labels) ? doc.labels : []
    );
    if (d.source === "rule" && d.confidence < 0.75) weakRule++;
    if (d.source === "gmail_tab") tabOnly++;
    if (d.source === "default") defaultHit++;
    if (doc.category && d.category !== doc.category) {
      drifted++;
      const key = `${doc.category} -> ${d.category}`;
      driftByCategory[key] = (driftByCategory[key] || 0) + 1;
    }
  }

  console.log(`\nRecent-${checked} sample recomputation:`);
  console.log(`  weak subject-only rule matches (AI-candidate pressure): ${weakRule}`);
  console.log(`  gmail-tab-only results: ${tabOnly}`);
  console.log(`  default/no-evidence results: ${defaultHit}`);
  console.log(`  stored-category drift vs current rules: ${drifted}`);
  const topDrifts = Object.entries(driftByCategory).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, n] of topDrifts) console.log(`    ${k}: ${n}`);

  console.log("\n(Read-only evaluation complete — nothing was written.)");
  await mongoose.connection.close();
})().catch(async (e) => {
  console.error("Eval failed:", e.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
