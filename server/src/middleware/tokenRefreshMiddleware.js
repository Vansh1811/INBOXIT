const axios = require("axios");
const User = require("../models/User");

const refreshGmailToken = async (req, res, next) => {
  try {
    const user = req.user; // already attached by protect middleware

    const expiresIn = new Date(user.tokenExpiry).getTime();
    const now = Date.now();
    const oneMinute = 60 * 1000;

    // token is still fresh → skip
    if (expiresIn > now + oneMinute) return next();

    // token expiring soon → refresh it
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: user.refreshToken,
        grant_type: "refresh_token",
      }
    );

    const { access_token, expires_in } = response.data;

    // update in Mongo + on req.user for this request
    user.accessToken = access_token;
    user.tokenExpiry = new Date(Date.now() + expires_in * 1000);
    await user.save();

    req.user = user; // updated tokens available downstream
    console.log("Gmail token refreshed ✅");
    next();

  } catch (err) {
    console.error("Token refresh failed ❌", err.message);
    // refresh token revoked → force re-login
    return res.status(401).json({
      message: "Gmail access revoked. Please login again.",
    });
  }
};

module.exports = { refreshGmailToken };
