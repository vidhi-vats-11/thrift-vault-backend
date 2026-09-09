import { Router } from "express"
import { timingSafeEqual } from "node:crypto"
import { env } from "../../config/env.js"
import { ApiError, asyncHandler } from "../../lib/errors.js"
import { releaseExpiredOrders } from "../../jobs/releaseExpiredOrders.js"

const router = Router()

// Compared byte-by-byte in constant time so the secret cannot be recovered by
// timing repeated guesses against this endpoint.
const matchesCronSecret = (token) => {
  const expected = Buffer.from(`Bearer ${env.cronSecret}`)
  const received = Buffer.from(token ?? "")
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const requireCron = (req, _res, next) => {
  // Without a configured secret the endpoint stays shut rather than open, so a
  // missing env var can never expose it.
  if (!env.cronSecret) return next(ApiError.notFound())
  if (!matchesCronSecret(req.get("authorization"))) return next(ApiError.unauthorized())
  next()
}

// Tech doc §4.3: the sweeper releases stock held by abandoned checkouts. A
// long-lived server runs it on a timer (see jobs/releaseExpiredOrders.js), but
// serverless functions do not stay alive between requests, so on Vercel this
// endpoint is driven by the cron schedule in vercel.json instead.
// Vercel Cron issues GET; POST is accepted too so the sweep can be triggered by
// hand without pretending to be a cron request.
router.all(
  "/sweep",
  requireCron,
  asyncHandler(async (_req, res) => {
    const released = await releaseExpiredOrders()
    res.json({ released })
  })
)

export default router
