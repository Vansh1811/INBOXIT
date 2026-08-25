/**
 * Aligns the user's lastHistoryId with Gmail's current head so the next
 * incremental sync is legitimately EMPTY — exercising the idle-poll
 * counting path end-to-end (read-only Gmail calls).
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { getGmailClient } = require("../src/utils/gmailClient");
const { enqueueSyncJob } = require("../src/queues/syncQueue");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({}).select("+accessToken +refreshToken");
  const gmail = await getGmailClient(user);

  const profile = await gmail.users.getProfile({ userId: "me" });
  const headId = String(profile.data.historyId);

  user.syncState.nextPageToken = null;
  await user.save();

  // Set cursor AFTER saving state; direct collection update avoids
  // re-encrypting tokens through the document.
  await mongoose.connection.db
    .collection("users")
    .updateOne({ _id: user._id }, { $set: { lastHistoryId: headId } });

  console.log(`HISTORY_ALIGNED=${headId}`);
  await enqueueSyncJob(user._id.toString(), "incremental");
  console.log("ENQUEUED_EMPTY_INCREMENTAL");

  // Watch idlePolls for up to 30s
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const fresh = await mongoose.connection.db.collection("users").findOne(
      { _id: user._id },
      { projection: { "syncState.idlePolls": 1, "syncState.isSyncing": 1 } }
    );
    if (fresh?.syncState?.isSyncing === false && (fresh?.syncState?.idlePolls || 0) > 0) {
      console.log(`IDLE_POLLS=${fresh.syncState.idlePolls}`);
      break;
    }
  }

  await mongoose.connection.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
