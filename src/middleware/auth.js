import jwt from "jsonwebtoken"
import { env } from "../config/env.js"
import { ApiError } from "../lib/errors.js"

export const requireAuth = (req, _res, next) => {
  const header = req.get("authorization") ?? ""
  const [scheme, token] = header.split(" ")

  if (scheme !== "Bearer" || !token) {
    return next(ApiError.unauthorized("Missing Bearer token"))
  }

  try {
    const payload = jwt.verify(token, env.jwt.accessSecret)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(ApiError.unauthorized("Invalid or expired access token"))
  }
}

// For public routes that behave slightly better when they know who is asking —
// the catalogue uses it to prioritise by the shopper's gender. Never rejects:
// a missing, malformed or expired token just means "browsing anonymously".
export const attachUser = (req, _res, next) => {
  const [scheme, token] = (req.get("authorization") ?? "").split(" ")
  if (scheme === "Bearer" && token) {
    try {
      const payload = jwt.verify(token, env.jwt.accessSecret)
      req.user = { id: payload.sub, role: payload.role }
    } catch {
      // Deliberately ignored — see above.
    }
  }
  next()
}

export const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== "admin") return next(ApiError.forbidden("Admin role required"))
  next()
}
