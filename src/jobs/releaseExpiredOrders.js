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

export const startOrderSweeper = (intervalMs = 60_000) => {
  const timer = setInterval(() => {
    releaseExpiredOrders().catch((err) =>
      logger.error("order_sweeper_failed", { message: err.message })
    )
  }, intervalMs)
  timer.unref()
  return timer
}
