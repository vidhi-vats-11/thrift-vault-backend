import { randomUUID } from "node:crypto"
import { logger } from "../lib/logger.js"

export const requestContext = (req, res, next) => {
  req.id = req.get("x-request-id") ?? randomUUID()
  res.setHeader("x-request-id", req.id)
  const startedAt = process.hrtime.bigint()

  res.on("finish", () => {
    logger.info("request", {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      userId: req.user?.id ?? null,
      latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    })
  })

  next()
}
