require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

async function checkUsers() {
  const MONGO_URI = process.env.MONGO_URI;
  await mongoose.connect(MONGO_URI);
  const users = await User.find({});
  console.log("Users in DB:", users.length);
  for (const u of users) {
    console.log("User:", u._id, u.email);
  }
  process.exit(0);
}
checkUsers();
