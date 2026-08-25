const jwt = require("jsonwebtoken");

/**
 * Shared auth-token extraction for HTTP requests and socket handshakes.
 *
 * Accepts, in order of preference:
 *   1. Authorization: Bearer <token>        (backward compatible)
 *   2. HttpOnly cookie "jwt"                (primary flow since OAuth callback
 *                                            no longer passes tokens in URLs)
 *
 * Returns the raw token string or null.
 */

const AUTH_COOKIE_NAME = "jwt";

function parseCookieHeader(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

function extractTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || null;
  }
  const cookies = parseCookieHeader(req.headers?.cookie);
  return cookies[AUTH_COOKIE_NAME] || null;
}

function extractTokenFromHandshake(handshake) {
  const bearer = handshake?.auth?.token; // legacy clients
  if (bearer) return bearer;
  return extractTokenFromRequest({ headers: handshake?.headers || {} });
}

function verifyAuthToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id ? decoded : null;
  } catch {
    return null;
  }
}

module.exports = {
  AUTH_COOKIE_NAME,
  extractTokenFromRequest,
  extractTokenFromHandshake,
  verifyAuthToken,
};
