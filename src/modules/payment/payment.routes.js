import { Router } from "express"
import { createHmac } from "node:crypto"
import { z } from "zod"
import { prisma } from "../../config/prisma.js"
import { env } from "../../config/env.js"
import { gateway } from "./gateway.js"
import { releaseOrder } from "../order/order.service.js"
import { requireAuth, requireAdmin } from "../../middleware/auth.js"
import { validate } from "../../middleware/validate.js"
import { ApiError, asyncHandler } from "../../lib/errors.js"
import { logger } from "../../lib/logger.js"
import { sendOrderConfirmation } from "../../lib/email.js"

const router = Router()

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const signature = req.get("x-webhook-signature")
    if (!gateway.verifyWebhook({ rawBody: req.rawBody, signature })) {
      throw ApiError.unauthorized("Invalid webhook signature")
    }

    const { event, gatewayRef } = gateway.parseWebhook(req.body)
    const payment = await prisma.payment.findUnique({
      where: { gatewayRef },
      include: { order: true },
    })

    if (!payment) throw ApiError.notFound("Unknown payment reference")

    // Gateways retry webhooks; once a payment has left "created" this is a duplicate.
    if (payment.status !== "created") {
      logger.info("webhook_duplicate", { gatewayRef, status: payment.status })
      return res.json({ received: true, duplicate: true, orderStatus: payment.order.status })
    }

    if (event === "payment.captured") {
      await prisma.$transaction([
        prisma.payment.update({ where: { id: payment.id }, data: { status: "captured" } }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { status: "paid", expiresAt: null },
        }),
      ])
      await sendOrderConfirmation(payment.orderId)
      logger.info("payment_captured", { orderId: payment.orderId, gatewayRef })
      return res.json({ received: true, orderStatus: "paid" })
    }

    if (event === "payment.failed") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } })
      await releaseOrder(payment.orderId, "payment_failed")
      logger.info("payment_failed", { orderId: payment.orderId, gatewayRef })
      return res.json({ received: true, orderStatus: "cancelled" })
    }

    res.json({ received: true, ignored: event })
  })
)

// Dev-only helper: returns the signature Postman needs, so testing the webhook
// doesn't require computing an HMAC by hand.
router.post(
  "/mock/sign",
  asyncHandler(async (req, res) => {
    if (env.nodeEnv === "production") throw ApiError.notFound()
    const rawBody = JSON.stringify(req.body)
    res.json({
      signature: createHmac("sha256", env.payments.webhookSecret).update(rawBody).digest("hex"),
      body: req.body,
    })
  })
)

router.post(
  "/:id/refund",
  requireAuth,
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } })
    if (!payment) throw ApiError.notFound("Payment not found")
    if (payment.status !== "captured") {
      throw ApiError.conflict(`Cannot refund a payment in status "${payment.status}"`)
    }

    const refund = await gateway.refund({
      gatewayRef: payment.gatewayRef,
      amountCents: payment.amountCents,
    })

    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "refunded" } }),
      prisma.order.update({ where: { id: payment.orderId }, data: { status: "cancelled" } }),
    ])

    res.json({ refund })
  })
)

export default router
