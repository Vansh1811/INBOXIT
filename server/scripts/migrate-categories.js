/**
 * One-time migration: multi-label `categories` array → canonical `category`.
 *
 * Run ONCE after deploying the Phase 2 schema change:
 *   cd server && node scripts/migrate-categories.js
 *
 * For every email document that still has the old shape:
 *   1. category := first valid entry of categories[] (rules were priority-
 *      sorted, so [0] was the strongest match), else "uncategorized"
 *   2. the legacy `categories` field is removed
 *   3. the obsolete {categories_1} index is dropped
 *
 * Idempotent — safe to re-run.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Email = require("../src/models/Email");
const { isValidCategory, UNCATEGORIZED } = require("../src/services/categories");

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const collection = mongoose.connection.db.collection("emails");

  // Documents still in the old shape (no canonical category field)
  const cursor = collection.find(
    { category: { $exists: false }, categories: { $exists: true } },
    { projection: { _id: 1, categories: 1 } }
  );

  let migrated = 0;
  let invalid = 0;
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const ops = batch.map(({ _id, category }) => ({
      updateOne: {
        filter: { _id },
        update: { $set: { category }, $unset: { categories: "" } },
      },
    }));
    await collection.bulkWrite(ops);
    migrated += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    const cats = Array.isArray(doc.categories) ? doc.categories : [];
    const chosen = cats.find((c) => isValidCategory(c));

    if (!chosen && cats.length > 0) {
      invalid++;
      console.warn(`⚠️  Doc ${doc._id} had non-canonical categories [${cats}] → ${UNCATEGORIZED}`);
    }

    batch.push({ _id: doc._id, category: chosen || UNCATEGORIZED });
    if (batch.length >= 500) await flush();
  }
  await flush();

  // Docs that had neither field (shouldn't happen, but stay safe)
  const neither = await collection.updateMany(
    { category: { $exists: false }, categories: { $exists: false } },
    { $set: { category: UNCATEGORIZED } }
  );
  migrated += neither.modifiedCount;

  // Drop the now-obsolete multikey index (ignore if missing)
  try {
    await collection.dropIndex("categories_1");
    console.log("Dropped index categories_1");
  } catch (err) {
    if (!/index not found/i.test(err.message)) throw err;
  }

  const remaining = await collection.countDocuments({ categories: { $exists: true } });
  console.log(`✅ Migrated ${migrated} documents (${invalid} with non-canonical values normalized)`);
  console.log(remaining === 0 ? "✅ No legacy documents remain" : `⚠️  ${remaining} legacy documents remain — re-run`);
  await mongoose.connection.close();
}

migrate().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
