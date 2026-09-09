import express from "express"
import cors from "cors"
import helmet from "helmet"
import path from "node:path"
import { env } from "./config/env.js"
import { requestContext } from "./middleware/requestContext.js"
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js"
import authRoutes from "./modules/auth/auth.routes.js"
import catalogRoutes from "./modules/catalog/catalog.routes.js"
import cartRoutes from "./modules/cart/cart.routes.js"
import wishlistRoutes from "./modules/wishlist/wishlist.routes.js"
import orderRoutes from "./modules/order/order.routes.js"
import paymentRoutes from "./modules/payment/payment.routes.js"
import newsletterRoutes from "./modules/newsletter/newsletter.routes.js"
import addressRoutes from "./modules/address/address.routes.js"
import adminRoutes from "./modules/admin/admin.routes.js"

export const createApp = () => {
  const app = express()

  app.set("trust proxy", 1)
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))
  app.use(cors({ origin: env.corsOrigins, credentials: true }))
  app.use(
    express.json({
      limit: "1mb",
      // Webhook signatures are computed over the exact bytes received, so the raw
      // body has to be captured before JSON.parse reformats it.
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8")
      },
    })
  )
  app.use(requestContext)

  app.use("/uploads", express.static(path.resolve(env.uploadDir)))

  app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }))

  const v1 = express.Router()
  v1.use("/auth", authRoutes)
  v1.use("/", catalogRoutes)
  v1.use("/cart", cartRoutes)
  v1.use("/wishlist", wishlistRoutes)
  v1.use("/orders", orderRoutes)
  v1.use("/payments", paymentRoutes)
  v1.use("/newsletter", newsletterRoutes)
  v1.use("/addresses", addressRoutes)
  v1.use("/admin", adminRoutes)

  app.use("/api/v1", v1)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
