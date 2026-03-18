const express = require("express");
const passport = require("passport");
const { signToken } = require("../utils/jwt");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();


// Step 1: redirect user to Google
router.get(
  "/google",
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

// Step 2: Google redirects here with code
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/" }),
  (req, res) => {
    const token = signToken(req.user._id);
    // send JWT to frontend via URL param (frontend stores in localStorage)
    res.redirect(`${process.env.CLIENT_URL}/auth/success?token=${token}`);
  }
);

// Protected: get current user
router.get("/me", protect, (req, res) => {
  const { _id, email, name, avatar, lastSyncedAt } = req.user;
  res.json({ _id, email, name, avatar, lastSyncedAt });
});

module.exports = router;
