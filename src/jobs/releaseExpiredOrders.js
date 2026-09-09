import { prisma } from "../config/prisma.js"
import { releaseOrder } from "../modules/order/order.service.js"
import { logger } from "../lib/logger.js"

// Tech doc §4.3: without this, an abandoned checkout leaves a one-of-one item
// held forever and unbuyable by anyone else.
export const releaseExpiredOrders = async () => {
  const expired = await prisma.order.findMany({
    where: { status: "pending_payment", expiresAt: { lte: new Date() } },
    select: { id: true },
  })

  for (const order of expired) {
    await releaseOrder(order.id, "hold_expired")
  }

  if (expired.length > 0) logger.info("expired_orders_released", { count: expired.length })
  return expired.length
}

let lastSweepAt = 0

// Serverless functions cannot hold a timer, and Vercel's Hobby plan only triggers
// cron once a day — far too slow when an abandoned checkout hides a one-of-one
// item from the catalogue. So browsing also drives the sweep, throttled so it
// costs one extra query a minute rather than one per request.
export const sweepIfDue = async (minIntervalMs = 60_000) => {
  const now = Date.now()
  if (now - lastSweepAt < minIntervalMs) return
  lastSweepAt = now
  try {
    await releaseExpiredOrders()
  } catch (err) {
    // A failed sweep must never break the request that happened to trigger it.
    logger.error("lazy_sweep_failed", { message: err.message })
  }
}

export const startOrderSweeper = (intervalMs = 60_000) => {
  const timer = setInterval(() => {
    releaseExpiredOrders().catch((err) =>
      logger.error("order_sweeper_failed", { message: err.message })
    )
  }, intervalMs)
  timer.unref()
  return timer
}
