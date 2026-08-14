const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");

const passport = require("./src/config/passport");
const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");
const authRoutes = require("./src/routes/authRoutes");
const syncRoutes = require("./src/routes/syncRoutes");
const emailRoutes = require("./src/routes/emailRoutes");
const webhookRoutes = require("./src/routes/webhookRoutes");

require("./src/queues/syncWorker");
require("./src/queues/actionWorker");

// NEW: http + socket
const http = require("http");
const { initSocket } = require("./src/config/socket");


const app = express();
const allowedOrigins = (  /// front end URL(s) from env or default
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(passport.initialize());

app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);
app.use("/api/emails", emailRoutes);
app.use("/webhooks", webhookRoutes);

app.get("/", (req, res) => res.json({ message: "InboxIt server running 🚀" }));

connectDB();
connectRedis();

// --- REPLACE THIS PART ---
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// WITH THIS:
const PORT = process.env.PORT || 5000;

// 1) Create HTTP server from Express app
const httpServer = http.createServer(app);

// 2) Attach Socket.IO
initSocket(httpServer);

// 3) Start server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
