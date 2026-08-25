const express = require("express");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { enqueueSyncJob } = require("../queues/syncQueue");
const { getIO } = require("../config/socket");

/**
 * Gmail Pub/Sub push webhook.
 *
 * Authentication model (Google's documented mechanism):
 *   The Pub/Sub push subscription is configured with an OIDC token
 *   ("Enable authentication" in the subscription's push config, with an
 *   audience string). Google then signs an ID token and sends it as
 *   `Authorization: Bearer <id_token>` on every push.
 *
 *   We verify signature (Google's public keys), issuer, expiry and audience
 *   before doing ANY work. Requests without a verifiable token are rejected.
 *
 * Required external setup:
 *   - Pub/Sub push subscription must have OIDC auth enabled and its audience
 *     set to the same value as PUBSUB_OIDC_AUDIENCE in server/.env.
 */

const router = express.Router();

// Belt-and-braces behind OIDC verification — blunts floods from any single
// source while tolerating legitimate bursts from Google's push infrastructure.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const googleAuthClient = new OAuth2Client();

async function verifyPubsubOidc(req, res, next) {
  const audience = process.env.PUBSUB_OIDC_AUDIENCE;
  if (!audience) {
    // Fail closed: never process unauthenticated pushes.
    console.error(
      "[Webhook] ❌ PUBSUB_OIDC_AUDIENCE not configured — rejecting push. " +
        "Set it to match your Pub/Sub subscription's OIDC audience."
    );
    return res.status(503).send("Webhook verification not configured");
  }

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).send("Unauthorized");
  }

  try {
    await googleAuthClient.verifyIdToken({
      idToken: authHeader.slice(7),
      audience, // enforces aud + exp + issuer + signature against Google certs
    });
    next();
  } catch (err) {
    console.error("[Webhook] ❌ OIDC verification failed:", err.message);
    return res.status(401).send("Unauthorized");
  }
}

router.post("/gmail", webhookLimiter, verifyPubsubOidc, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message.data !== "string") {
      return res.status(400).send("Bad Request");
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(message.data, "base64").toString("utf-8"));
    } catch {
      return res.status(400).send("Bad Request"); // poison message — drop it
    }

    const { emailAddress } = payload;
    if (!emailAddress || typeof emailAddress !== "string") {
      return res.status(400).send("Bad Request");
    }

    const user = await User.findOne({ email: emailAddress });
    if (!user) {
      // 200 (not 404): unknown addresses must not be enumerable by probing,
      // and non-2xx makes Pub/Sub retry forever for accounts we don't host.
      console.warn(`[Webhook] Push for unknown account — ignored`);
      return res.status(200).send("OK");
    }

    const userId = user._id.toString();

    // Emit sync:incoming BEFORE fetching the message (best-effort)
    try {
      const syncId = `push-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      getIO().to(userId).emit("sync:incoming", {
        syncId,
        timestamp: Date.now(),
        userId,
      });
    } catch {
      // socket.io not ready — push still proceeds
    }

    await enqueueSyncJob(userId, "incremental");

    res.status(200).send("OK");
  } catch (error) {
    console.error("[Webhook] Gmail push error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
