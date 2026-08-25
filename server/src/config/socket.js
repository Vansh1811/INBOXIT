// src/config/socket.js
const { Server } = require("socket.io");
const logger = require("../utils/logger").child({ component: "socket" });
const {
  extractTokenFromHandshake,
  verifyAuthToken,
} = require("../utils/authRequest");

let io;

const initSocket = (httpServer, { allowedOrigins = [] } = {}) => {
  io = new Server(httpServer, {
    cors: {
      // Explicit origins with credentials — never "*"
      origin: allowedOrigins.length ? allowedOrigins : false,
      credentials: true, // the auth cookie travels with the handshake
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    // Accepts HttpOnly cookie (primary) or handshake.auth.token (legacy clients)
    const token = extractTokenFromHandshake(socket.handshake);
    const decoded = verifyAuthToken(token);
    if (!decoded) return next(new Error("Unauthorized"));

    socket.userId = decoded.id;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    socket.join(userId);
    logger.info(`User ${userId} connected via WebSocket`);

    socket.on("disconnect", () => {
      logger.info(`User ${userId} disconnected`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
};

module.exports = { initSocket, getIO };
