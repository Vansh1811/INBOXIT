const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const { validateEnv } = require("./src/config/envCheck");
validateEnv(); // fail fast with a clear message if config is missing

const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const passport = require("./src/config/passport");
const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");
const authRoutes = require("./src/routes/authRoutes");
const syncRoutes = require("./src/routes/syncRoutes");
const emailRoutes = require("./src/routes/emailRoutes");
const webhookRoutes = require("./src/routes/webhookRoutes");

const { syncQueue } = require("./src/queues/syncQueue");
const { actionQueue } = require("./src/queues/actionQueue");

// NEW: http + socket
const http = require("http");
const { initSocket } = require("./src/config/socket");


const app = express();

// Behind reverse proxies (Render/Render-like PaaS, nginx) so rate limiters
// see the real client IP instead of the proxy IP
app.set("trust proxy", 1);

// Security headers (HSTS disabled outside production to avoid caching an
// HSTS rule for http://localhost during development)
app.use(
  helmet({
    hsts: process.env.NODE_ENV === "production" ? {} : false,
  })
);

const allowedOrigins = (  /// front end URL(s) from env or default
  process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // required: auth cookie is sent with cross-origin XHR
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(passport.initialize());

// General API abuse guard — generous enough that normal app usage and the
// dashboard never hit it; exists only to blunt trivial flooding.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down." },
});

app.use("/auth", apiLimiter, authRoutes);
app.use("/sync", syncRoutes);
app.use("/api/emails", apiLimiter, emailRoutes);
app.use("/webhooks", webhookRoutes); // webhook has its own stricter limiter inside

app.get("/", (req, res) => res.json({ message: "InboxIt server running 🚀" }));

connectDB();
connectRedis().catch((err) => {
  console.error("Redis connection failed ❌", err.message);
});

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);
initSocket(httpServer, { allowedOrigins });

// Clear stale jobs left in Redis from previous runs so workers
// only ever process jobs enqueued AFTER this server started
// (i.e. triggered by OAuth login / sync routes / webhooks)
const startServer = async () => {
  try {
    await Promise.all([
      syncQueue.obliterate({ force: true }),
      actionQueue.obliterate({ force: true }),
    ]);
    console.log("🧹 Cleared stale queued jobs from Redis");
  } catch (err) {
    console.error("⚠️  Failed to clear stale jobs:", err.message);
  }

  // Attach workers ONLY after the queues are clean
  require("./src/queues/syncWorker");
  require("./src/queues/actionWorker");

  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
