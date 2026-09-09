import Redis from "ioredis"
import { env } from "./env.js"
import { logger } from "../lib/logger.js"

// Redis is optional: without it the rate limiter falls back to an in-process counter,
// which is correct for single-instance local dev but not across replicas.
export const redis = env.redisUrl
  ? new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false })
  : null

if (redis) {
  redis.on("error", (err) => logger.warn("redis_error", { message: err.message }))
}
