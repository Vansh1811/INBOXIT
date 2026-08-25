/**
 * T3: verifies that an action job which fails ALL retries reconciles the
 * immediate local mutation (isDeleted flipped back to false).
 *
 * Seeds a synthetic email marked deleted, enqueues "delete" against a fake
 * Gmail message id (Google returns 404), then polls Mongo until reverted.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { enqueueActionJob } = require("../src/queues/actionQueue");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const user = await User.findOne({}).select("_id");
  const userId = user._id.toString();

  const gmailFakeId = "phase3-fake-gmail-id";
  const doc = {
    userId: user._id,
    gmailMessageId: gmailFakeId,
    from: "Phase3 Tester <t@phase3test.dev>",
    subject: "phase3 reconciliation test",
    snippet: "synthetic",
    receivedAt: new Date(),
    category: "uncategorized",
    userOverride: false,
    isRead: true,
    isStarred: false,
    isDeleted: true, // as if delete was already applied locally
    labels: [],
  };

  await db.collection("emails").deleteMany({ gmailMessageId: gmailFakeId });
  const { insertedId } = await db.collection("emails").insertOne(doc);
  console.log(`SEEDED _id=${insertedId}`);

  await enqueueActionJob(
    userId,
    insertedId.toString(),      // emailKey
    gmailFakeId,                // fake Gmail id -> will 404
    "delete",
    [insertedId.toString()]
  );

  console.log("WAITING_FOR_RECONCILE…");
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const d = await db.collection("emails").findOne({ _id: insertedId });
    if (!d) { console.log("RESULT=MISSING_DOC"); break; }
    if (d.isDeleted === false) {
      console.log("RESULT=RECONCILED (isDeleted back to false)");
      break;
    }
  }

  // cleanup
  await db.collection("emails").deleteMany({ gmailMessageId: gmailFakeId });
  console.log("CLEANED_UP");
  await mongoose.connection.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
