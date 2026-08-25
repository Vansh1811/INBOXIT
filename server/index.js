const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const { validateEnv } = require("./src/config/envCheck");
validateEnv(); // fail fast with a clear message if config is missing

const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const passport = require("./src/config/passport");
const connectDB = require("./src/config/db");
const { redisClient, connectRedis } = require("./src/config/redis");
const requestId = require("./src/middleware/requestId");
const { errorHandler } = require("./src/middleware/errorHandler");
const authRoutes = require("./src/routes/authRoutes");
const syncRoutes = require("./src/routes/syncRoutes");
const emailRoutes = require("./src/routes/emailRoutes");
const webhookRoutes = require("./src/routes/webhookRoutes");

const { syncQueue } = require("./src/queues/syncQueue");
const { actionQueue } = require("./src/queues/actionQueue");

// http + socket.io
const http = require("http");
const { initSocket, getIO } = require("./src/config/socket");
const logger = require("./src/utils/logger").child({ component: "server" });

const app = express();

// Behind reverse proxies (Render-like PaaS, nginx) so rate limiters
// see the real client IP instead of the proxy IP
app.set("trust proxy", 1);

// Security headers (HSTS disabled outside production to avoid caching an
// HSTS rule for http://localhost during development)
app.use(
  helmet({
    hsts: process.env.NODE_ENV === "production" ? {} : false,
  })
);

const allowedOrigins = (
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

// Request correlation — must run before routes so every handler has req.log
app.use(requestId);

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

// Readiness probe: 200 only when both data stores are reachable.
app.get("/health", async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = false;
  let timerId;
  try {
    redisOk = (await Promise.race([
      redisClient.ping(),
      new Promise((_, rej) => {
        timerId = setTimeout(() => rej(new Error("timeout")), 1500);
      }),
    ])) === "PONG";
  } catch {
    redisOk = false;
  } finally {
    clearTimeout(timerId);
  }
  res.status(mongoOk && redisOk ? 200 : 503).json({
    status: mongoOk && redisOk ? "ok" : "degraded",
    mongo: mongoOk,
    redis: redisOk,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// ── O-M3: queue depth visibility (counts only — no payloads) ────────────────
app.get("/internal/queues", async (req, res) => {
  const withTimeout = (p) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
    ]);

  const safeCounts = async (queue) => {
    try {
      const c = await withTimeout(queue.getJobCounts());
      return { waiting: c.waiting || 0, active: c.active || 0, failed: c.failed || 0 };
    } catch {
      return null; // Redis unreachable — reported as null, endpoint still 200
    }
  };

  const [sync, action] = await Promise.all([
    safeCounts(syncQueue),
    safeCounts(actionQueue),
  ]);

  res.json({
    queues: { "gmail-sync": sync, "email-action": action },
  });
});

connectDB();
connectRedis().catch((err) => {
  logger.error({ err: err.message }, "Redis connection failed");
});

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);
const io = initSocket(httpServer, { allowedOrigins });

// Workers attach during startup; the shutdown hook reads this same array.
const attachedWorkers = [];

/**
 * Startup queue maintenance — deliberately NOT obliterate():
 *
 * The old behavior wiped ALL queued jobs AND every user's repeatable live-
 * tracking job on each boot, silently killing 60s polling until users logged
 * in again, and making multi-instance deployments impossible.
 *
 * Jobs are idempotent (upserts everywhere), so letting queued work survive a
 * restart is safe — interrupted syncs simply resume. We only clear bounded
 * dead-letter/completed leftovers.
 */
const maintainQueuesAtBoot = async () => {
  for (const [name, q] of [["gmail-sync", syncQueue], ["email-action", actionQueue]]) {
    // O-M3: preserve evidence before wiping — log what previously failed
    try {
      const failedJobs = await q.getFailed(0, 10);
      for (const j of failedJobs) {
        logger.warn(
          {
            queue: name,
            jobId: j.id,
            userId: j.data?.userId,
            attempts: j.attemptsMade,
            failedReason: j.failedReason,
          },
          "Previously failed job (being cleaned at boot)"
        );
      }
    } catch {}

    for (const type of ["failed", "completed"]) {
      try {
        const ids = await q.clean(0, 1000, type);
        if (ids.length) logger.info({ queue: name, type, count: ids.length }, "Boot-cleaned jobs");
      } catch (err) {
        logger.warn({ queue: name, type, err: err.message }, "Boot-clean skipped");
      }
    }
  }
};

const startServer = async () => {
  // Workers attach immediately — any jobs left behind by a crashed instance
  // are resumed rather than destroyed.
  const { worker: syncWorker, setEmitter } = require("./src/queues/syncWorker");
  const { actionWorker } = require("./src/queues/actionWorker");
  attachedWorkers.push(syncWorker, actionWorker);

  // Route worker emissions through the running socket.io instance
  setEmitter((userId, event, payload) => {
    try { getIO().to(userId).emit(event, payload); } catch { /* not ready */ }
  });

  await maintainQueuesAtBoot();

  httpServer.listen(PORT, () => {
    logger.info({ port: PORT }, "Server running");
  });
};

const { installGracefulShutdown } = require("./src/utils/gracefulShutdown");
installGracefulShutdown({
  httpServer,
  io,
  workers: attachedWorkers,
  queues: [syncQueue, actionQueue],
});

startServer();

// Terminal error handler — MUST be registered after all routes (O-M2):
// catches unguarded async rejections (e.g. syncRoutes) and any thrown errors.
app.use(errorHandler);
