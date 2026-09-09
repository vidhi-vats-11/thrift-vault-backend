import { redis } from "../config/redis.js"
import { ApiError } from "../lib/errors.js"

const memory = new Map()

const hitMemory = (key, windowMs) => {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return 1
  }
  entry.count += 1
  return entry.count
}

const hitRedis = async (key, windowMs) => {
  const count = await redis.incr(key)
  if (count === 1) await redis.pexpire(key, windowMs)
  return count
}

export const rateLimit = ({ windowMs, max, prefix }) => async (req, _res, next) => {
  const key = `rl:${prefix}:${req.user?.id ?? req.ip}`
  try {
    const count = redis ? await hitRedis(key, windowMs) : hitMemory(key, windowMs)
    if (count > max) return next(ApiError.tooManyRequests())
    next()
  } catch {
    next()
  }
}
