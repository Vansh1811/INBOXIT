const User = require("../models/User");
const {
  extractTokenFromRequest,
  verifyAuthToken,
} = require("../utils/authRequest");

const protect = async (req, res, next) => {
  try {
    // Accepts HttpOnly auth cookie (primary) or Authorization: Bearer (legacy)
    const token = extractTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = verifyAuthToken(token); // null if expired/invalid
    if (!decoded) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    req.user = user; // attach full user to request
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = { protect };
