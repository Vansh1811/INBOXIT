const crypto = require("crypto");
const logger = require("../utils/logger");

/**
 * Request correlation (O-M1).
 *
 * Assigns every HTTP request an id, echoes it via X-Request-Id, and attaches
 * req.log — a structured logger child pre-bound with the requestId. The auth
 * middleware later enriches req.log with userId.
 */
module.exports = function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  req.log = logger.child({ requestId: req.id });
  next();
};
