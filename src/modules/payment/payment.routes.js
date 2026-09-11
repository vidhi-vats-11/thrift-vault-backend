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

/**
 * Moves a payment (and its order) to its settled state.
 *
 * Extracted so the real webhook and the demo's confirm endpoint drive orders
 * through exactly the same transition. If these were two code paths they would
 * drift, and the demo would stop proving that the real one works.
 *
 * Returns null when the payment has already left "created" — gateways retry
 * webhooks, and a shopper can double-click a button, so this has to be idempotent.
 */
const settlePayment = async (payment, event) => {
  if (payment.status !== "created") return null

  if (event === "payment.captured") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "captured" } }),
      prisma.order.update({
        where: { id: payment.orderId },
        data: { status: "paid", expiresAt: null },
      }),
    ])
    await sendOrderConfirmation(payment.orderId)
    logger.info("payment_captured", { orderId: payment.orderId, gatewayRef: payment.gatewayRef })
    return "paid"
  }

  if (event === "payment.failed") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } })
    await releaseOrder(payment.orderId, "payment_failed")
    logger.info("payment_failed", { orderId: payment.orderId, gatewayRef: payment.gatewayRef })
    return "cancelled"
  }

  return undefined
}

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

    const orderStatus = await settlePayment(payment, event)
    if (orderStatus === undefined) return res.json({ received: true, ignored: event })
    res.json({ received: true, orderStatus })
  })
)

/**
 * Settles a payment for the demo, in place of a real provider's webhook.
 *
 * This replaces an earlier approach where the browser asked the API to HMAC-sign a
 * webhook body and then posted that webhook to itself. That helper was disabled
 * under NODE_ENV=production — correctly, since handing a signing oracle to the
 * client lets anyone forge a "paid" event for any order — but checkout depended on
 * it, so on the live deploy paying returned 404.
 *
 * The fix is not to re-enable the signer. It is to stop signing in the browser at
 * all: the client now just says "this order of mine is paid", and the server
 * decides, having checked three things —
 *
 *   1. there is a session (requireAuth),
 *   2. the payment belongs to THIS shopper's order, so nobody can settle someone
 *      else's checkout,
 *   3. the configured gateway is the mock one, so wiring in a real provider
 *      disables this route rather than leaving a free-money endpoint behind.
 *
 * The webhook itself is untouched and still signature-verified.
 */
router.post(
  "/mock/confirm",
  requireAuth,
  validate({
    body: z.object({
      gatewayRef: z.string().min(1),
      fail: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (env.payments.gateway !== "mock") {
      throw ApiError.notFound("Not available for this payment gateway")
    }

    const payment = await prisma.payment.findUnique({
      where: { gatewayRef: req.body.gatewayRef },
      include: { order: true },
    })
    // "Not found" rather than "forbidden" for someone else's payment, so this can't
    // be used to probe which gateway references exist.
    if (!payment || payment.order.userId !== req.user.id) {
      throw ApiError.notFound("Payment not found")
    }

    if (payment.status !== "created") {
      return res.json({ ok: true, duplicate: true, orderStatus: payment.order.status })
    }

    const orderStatus = await settlePayment(
      payment,
      req.body.fail ? "payment.failed" : "payment.captured"
    )
    res.json({ ok: true, orderStatus })
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
