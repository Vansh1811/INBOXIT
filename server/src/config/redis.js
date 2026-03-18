const Redis = require("ioredis");

const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 5000), // retry with backoff up to 5s
  enableOfflineQueue: true,
  connectTimeout: 10000,
  keepAlive: 5000,        // 🔥 ping every 5s to keep connection alive
  reconnectOnError: (err) => {
    return err.message.includes("ECONNRESET") || err.message.includes("ENOTFOUND");
  },
});

redisClient.on("error", (err) => console.error("Redis error ❌", err));
redisClient.on("connect", () => console.log("Redis connected ✅"));

const connectRedis = async () => {
  // ioredis auto-connects, so just wait for ready event
  return new Promise((resolve, reject) => {
    redisClient.once("ready", resolve);
    redisClient.once("error", reject);
  });
};

module.exports = { redisClient, connectRedis };