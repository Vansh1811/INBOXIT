const express = require("express");
const passport = require("passport");
const rateLimit = require("express-rate-limit");
const { signToken } = require("../utils/jwt");
const { protect } = require("../middleware/authMiddleware");
const { AUTH_COOKIE_NAME } = require("../utils/authRequest");

const router = express.Router();

const isProd = process.env.NODE_ENV === "production";

// Brute-force / flood guard on the OAuth initiation endpoint.
// The callback itself can only be reached through Google's redirect.
const oauthStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
});

function buildAuthCookieOptions() {
  return {
    httpOnly: true,                              // never readable from JS (XSS hardening)
    secure: isProd,                              // HTTPS-only in production
    sameSite: "lax",                             // survives the Google top-level redirect;
                                                 // sent on same-site XHR (app + API share a site)
    domain: process.env.COOKIE_DOMAIN || undefined, // set e.g. ".inboxit.in" when app/API
                                                    // are sibling subdomains; omit for localhost
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,             // matches JWT expiry (7d)
  };
}

// Step 1: redirect user to Google
router.get(
  "/google",
  oauthStartLimiter,
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    accessType: "offline", // gets us a refreshToken
    prompt: "consent",     // forces Google to return refreshToken every time
  })
);

// Step 2: Google redirects here with code.
// The JWT is delivered via an HttpOnly cookie — NEVER in the URL
// (query tokens leak into browser history, server logs and Referer headers).
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/" }),
  (req, res) => {
    const token = signToken(req.user._id);
    res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions());
    // No token in the redirect target:
    res.redirect(`${process.env.CLIENT_URL}/auth/success`);
  }
);

// Logout: clears the authentication cookie.
router.post("/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/",
  });
  return res.json({ message: "Logged out" });
});

// Protected: get current user (also used by the client to verify the session)
router.get("/me", protect, (req, res) => {
  const { _id, email, name, avatar, lastSyncedAt } = req.user;
  res.json({ _id, email, name, avatar, lastSyncedAt });
});

module.exports = router;
