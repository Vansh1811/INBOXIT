/**
 * Minimal zero-dependency structured logger.
 *
 * One JSON object per line on stdout:
 *   {"time":"2026-01-01T00:00:00.000Z","level":"info","msg":"...","userId":"…"}
 *
 * - child(bindings) merges context into every subsequent line
 * - Errors passed as arguments are serialized to {message, stack}
 * - LOG_LEVEL env var filters (debug|info|warn|error), default "info"
 *
 * Deliberately NOT used by config/db.js and config/envCheck.js: those run
 * before anything is initialized and must never depend on this module.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD =
  LEVELS[String(process.env.LOG_LEVEL || "").toLowerCase()] ?? LEVELS.info;

function serializeArg(arg) {
  if (arg instanceof Error) {
    return { err: { message: arg.message, stack: arg.stack } };
  }
  return arg;
}

function emit(stream, level, bindings, args) {
  if (LEVELS[level] < THRESHOLD) return;

  const msgParts = [];
  const meta = {};

  for (const arg of args) {
    const s = serializeArg(arg);
    if (typeof s === "string") msgParts.push(s);
    else if (s && typeof s === "object") Object.assign(meta, s);
  }

  let line;
  try {
    line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg: msgParts.join(" "),
      ...bindings,
      ...meta,
    });
  } catch {
    // Circular structures etc. — fall back to a safe inspection string.
    const util = require("util");
    line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg: msgParts.join(" "),
      raw: util.inspect(args, { depth: 2 }),
    });
  }

  stream(line);
}

function makeLogger(bindings = {}) {
  const log = (level) => (...args) =>
    emit(
      level === "error" ? console.error : level === "warn" ? console.warn : console.log,
      level,
      bindings,
      args
    );

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

module.exports = makeLogger();
