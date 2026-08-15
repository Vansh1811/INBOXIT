require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

async function investigate() {
  const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/inboxit";
  await mongoose.connect(MONGO_URI);
  
  try {
    const user = await User.findOne({});
    if (!user) {
      console.log("No users found.");
      return;
    }

    console.log("--- RAW MONGO DOCUMENT ---");
    const rawDoc = await mongoose.connection.db.collection('users').findOne({ _id: user._id });
    console.log(`lastHistoryId: ${JSON.stringify(rawDoc.lastHistoryId)} (${typeof rawDoc.lastHistoryId})`);
    console.log(`nextPageToken: ${JSON.stringify(rawDoc.syncState?.nextPageToken)} (${typeof rawDoc.syncState?.nextPageToken})`);
    
    console.log("\n--- MONGOOSE LOADED DOCUMENT ---");
    console.log(`user.lastHistoryId: ${JSON.stringify(user.lastHistoryId)} (${typeof user.lastHistoryId})`);
    console.log(`user.syncState.nextPageToken: ${JSON.stringify(user.syncState?.nextPageToken)} (${typeof user.syncState?.nextPageToken})`);
    
    console.log("\n--- RUNTIME EVALUATION ---");
    let nextPageToken = user.syncState?.nextPageToken || null;
    let hasPendingPages = !!user.syncState?.nextPageToken;
    let didFallback = true; // as per user trace
    
    console.log(`nextPageToken variable: ${JSON.stringify(nextPageToken)}`);
    console.log(`is truthy?: ${!!nextPageToken}`);
    console.log(`hasPendingPages: ${hasPendingPages}`);
    
    console.log(`\nSimulated Log: [EmailSyncService] Fallback chunk (resumeToken=${nextPageToken ? "saved" : "fresh"})...`);
    
  } finally {
    await mongoose.connection.close();
  }
}

investigate();
