import { ApiError } from "../lib/errors.js"

export const validate = ({ body, query, params }) => (req, _res, next) => {
  try {
    if (params) req.params = params.parse(req.params)
    if (query) req.validatedQuery = query.parse(req.query)
    if (body) req.body = body.parse(req.body)
    next()
  } catch (err) {
    if (err.issues) {
      return next(
        ApiError.badRequest(
          "Validation failed",
          err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
        )
      )
    }
    next(err)
  }
}
