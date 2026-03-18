const express = require("express");
const dotenv = require("dotenv");
dotenv.config();


const passport = require("./src/config/passport");
const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");
const authRoutes = require("./src/routes/authRoutes");
const syncRoutes = require("./src/routes/syncRoutes");


// start BullMQ worker
require("./src/queues/syncWorker");

const app = express();
app.use(express.json());
app.use(passport.initialize());

app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);

app.get("/", (req, res) => res.json({ message: "InboxIt server running 🚀" }));

connectDB();
connectRedis();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
