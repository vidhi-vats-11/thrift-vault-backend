import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { prisma } from "./config/prisma.js"
import { redis } from "./config/redis.js"
import { logger } from "./lib/logger.js"
import { startOrderSweeper } from "./jobs/releaseExpiredOrders.js"

const app = createApp()
const server = app.listen(env.port, () => {
  logger.info("server_started", { port: env.port, env: env.nodeEnv })
})

startOrderSweeper()

const shutdown = async (signal) => {
  logger.info("shutting_down", { signal })
  server.close()
  await prisma.$disconnect()
  if (redis) redis.disconnect()
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
