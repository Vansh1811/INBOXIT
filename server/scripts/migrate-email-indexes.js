/**
 * Phase 4 index migration — run ONCE per database after deploying.
 *   cd server && node scripts/migrate-email-indexes.js
 *
 * 1. Drops the dead {subject:"text", from:"text"} index (no $text query
 *    exists anywhere; it only added write amplification).
 * 2. Creates the {userId:1, labels:1, receivedAt:-1} compound if absent —
 *    covers the inbox/unread hot path with sort order included.
 *
 * Idempotent and safe to re-run.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const TEXT_INDEX_NAMES = ["subject_text_from_text"];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const coll = mongoose.connection.db.collection("emails");

  const indexes = await coll.indexes();
  console.log("Existing indexes:", indexes.map((i) => i.name).join(", "));

  // 1. Drop the unused text index (any name variant)
  for (const name of TEXT_INDEX_NAMES) {
    if (indexes.some((i) => i.name === name)) {
      try {
        await coll.dropIndex(name);
        console.log(`✅ Dropped text index: ${name}`);
      } catch (err) {
        console.warn(`⚠️  Could not drop ${name}:`, err.message);
      }
    } else {
      console.log(`• Text index ${name} not present (already dropped)`);
    }
  }

  // 2. Ensure the labels compound exists (createIndex is idempotent)
  await coll.createIndex({ userId: 1, labels: 1, receivedAt: -1 });
  console.log("✅ Ensured index { userId:1, labels:1, receivedAt:-1 }");

  const final = await coll.indexes();
  console.log("Final indexes:", final.map((i) => i.name).join(", "));

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
