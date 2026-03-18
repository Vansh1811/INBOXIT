// Reset user sync state for a clean re-sync
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/User");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  
  const r = await User.updateOne(
    { _id: "69ba538d7ec7964903caa7f8" },
    {
      $set: {
        lastHistoryId: null,
        lastSyncedAt: null,
        "syncState.isSyncing": false,
        "syncState.totalSynced": 0,
        "syncState.nextPageToken": null,
      },
    }
  );
  
  console.log("Reset result:", JSON.stringify(r));
  await mongoose.disconnect();
})();
