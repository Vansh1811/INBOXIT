/**
 * Phase 3 FIX 4 — /health endpoint verification.
 *
 * Boots the real server as a child process with PORT=5099 (same port we
 * probe), retries until the process reports ready, asserts a healthy
 * response, and ALWAYS terminates the child in finally.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const http = require("http");
const { spawn } = require("child_process");

const PORT = 5099;

function probeHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}/health`, { timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.on("error", reject);
  });
}

async function waitForReady(child) {
  for (let i = 0; i < 20; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      return await probeHealth();
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("server never became ready");
}

async function main() {
  const child = spawn(process.execPath, ["index.js"], {
    stdio: "inherit",
    cwd: require("path").resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) }, // FIX: server and probe agree on the port
  });

  try {
    const { status, body } = await waitForReady(child);
    console.log(`Health response: ${status} ${body}`);

    if (status !== 200 || !/"mongo":true/.test(body) || !/"redis":true/.test(body)) {
      console.error("❌ Health check did not report healthy");
      process.exitCode = 1;
    } else {
      console.log("✅ /health reported ok (mongo + redis reachable)");
    }
  } catch (e) {
    console.error("❌ Health verification failed:", e.message);
    process.exitCode = 1;
  } finally {
    // ALWAYS terminate the spawned server
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(() => r(false), 8000)),
      ]);
      if (!exited && child.exitCode === null) {
        console.warn("⚠️ Child ignored SIGTERM — force killing");
        child.kill("SIGKILL");
      }
    }
    console.log("🧹 Server child process terminated");
  }
}

main();
