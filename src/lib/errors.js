export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message, details) {
    return new ApiError(400, "bad_request", message, details)
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "unauthorized", message)
  }

  static forbidden(message = "Not allowed") {
    return new ApiError(403, "forbidden", message)
  }

  static notFound(message = "Not found") {
    return new ApiError(404, "not_found", message)
  }

  static conflict(message, details) {
    return new ApiError(409, "conflict", message, details)
  }

  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, "rate_limited", message)
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
