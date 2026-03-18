// src/config/redis.js (ONLY this)
const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => console.error("Redis error ❌", err));
redisClient.on("connect", () => console.log("Redis connected ✅"));

const connectRedis = async () => {
  await redisClient.connect();
};

module.exports = { redisClient, connectRedis };
