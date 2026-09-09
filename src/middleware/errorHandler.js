import { ApiError } from "../lib/errors.js"
import { logger } from "../lib/logger.js"

export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`))
}

// Prisma surfaces constraint violations as generic errors; without this they would
// all leave the API as 500s even though they are client mistakes.
const fromPrisma = (err) => {
  if (err.code === "P2002") {
    return ApiError.conflict(`A record with that ${err.meta?.target ?? "value"} already exists`)
  }
  if (err.code === "P2025") return ApiError.notFound("Record not found")
  if (err.code === "P2003") return ApiError.badRequest("Referenced record does not exist")
  return null
}

export const errorHandler = (rawErr, req, res, _next) => {
  const err = rawErr.status ? rawErr : (fromPrisma(rawErr) ?? rawErr)
  const status = err.status ?? 500
  const code = err.status ? err.code : "internal_error"

  if (status >= 500) {
    logger.error("unhandled_error", { requestId: req.id, message: err.message, stack: err.stack })
  }

  res.status(status).json({
    error: {
      code,
      message: status >= 500 ? "Internal server error" : err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId: req.id,
    },
  })
}
