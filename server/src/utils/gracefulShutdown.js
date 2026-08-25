const mongoose = require("mongoose");
const { redisClient } = require("../config/redis");

/**
 * Graceful shutdown.
 *
 * Order matters:
 *   1. stop accepting NEW work/traffic (http + socket.io, dropping idle conns)
 *   2. close BullMQ workers — bounded wait for in-flight jobs
 *   3. close queue clients
 *   4. close Redis + Mongo
 *
 * In-flight jobs that can't finish within the bound are abandoned safely:
 * BullMQ's stall detection fires, and the syncWorker's stalled handler
 * releases that user's sync lock — recovery is designed-in.
 *
 * A hard-exit timer guarantees we never hang past SHUTDOWN_TIMEOUT_MS.
 */

const SHUTDOWN_TIMEOUT_MS = 15_000;
const WORKER_CLOSE_TIMEOUT_MS = 8_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) =>
      setTimeout(() => {
        console.warn(`⏱️  ${label} did not finish in ${ms}ms — continuing`);
        resolve();
      }, ms)
    ),
  ]);
}

function installGracefulShutdown({ httpServer, io, workers = [], queues = [] }) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return; // ignore repeated signals
    shuttingDown = true;

    console.log(`\n🛑 ${signal} received — shutting down gracefully…`);
    const hardExit = setTimeout(() => {
      console.error("⚠️  Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    try {
      // 1. Stop traffic. Drop idle keep-alive sockets so httpServer.close()
      //    doesn't hang on a lingering connection.
      io?.close();
      if (httpServer) {
        httpServer.closeIdleConnections?.();
        await new Promise((r) => httpServer.close(r));
        httpServer.closeAllConnections?.();
      }

      // 2–3. Workers finish current jobs when they can; bounded.
      await Promise.allSettled(
        workers.map((w) => withTimeout(w.close(), WORKER_CLOSE_TIMEOUT_MS, "worker.close()"))
      );
      await Promise.allSettled(queues.map((q) => q.close()));

      // 4. Data stores last
      try { redisClient.disconnect(); } catch {}
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }

      clearTimeout(hardExit);
      console.log("✅ Shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("❌ Error during shutdown:", err.message);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    // Deliberately just logging. Many libraries still throw unhandled rejections for minor network flakes.
    console.error("⚠️ [unhandledRejection] Not crashing process, but tracking:", reason instanceof Error ? reason.stack : reason);
  });
  
  process.on("uncaughtException", (err) => {
    console.error("🔥 [uncaughtException] Process state corrupted, exiting reliably.", err.stack || err.message);
    // Do not attempt long graceful worker shutdown (which could hang or fail cascadingly).
    // Attempt minimal bounded cleanup of critical resources.
    try {
      io?.close();
      try { redisClient.disconnect(); } catch {}
      if (mongoose.connection.readyState !== 0) {
        mongoose.connection.close(false); // async fire-and-forget
      }
    } catch (e) {
      console.error("Error during minimal uncaughtException cleanup:", e.message);
    }
    
    setTimeout(() => process.exit(1), 1000).unref();
  });
}

module.exports = { installGracefulShutdown };
