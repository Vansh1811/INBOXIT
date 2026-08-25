/**
 * Boots the real server in-process on an isolated port, probes nothing,
 * then emits SIGTERM to exercise the full graceful-shutdown path
 * (Windows cannot deliver console signals across processes).
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
process.env.PORT = "5099";

require("../index"); // boots express + socket.io + workers + queue maintenance

setTimeout(() => {
  console.log("[verify] emitting SIGTERM…");
  process.emit("SIGTERM");
}, 8000);

process.on("exit", (code) => {
  console.log(`VERIFY_EXIT_CODE=${code}`);
});
