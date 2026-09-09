import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { env } from "../../../config/env.js"

// Stands in for Razorpay/Stripe during local development. Signature scheme mirrors
// Razorpay's (HMAC-SHA256 over the raw body) so swapping in the real adapter is a
// config change, not an API change.
export const mockGateway = {
  name: "mock",

  async createPaymentIntent({ orderId, amountCents, currency = "INR" }) {
    return {
      gatewayRef: `mock_pay_${randomUUID()}`,
      amountCents,
      currency,
      orderId,
      // The client would hand this to the gateway SDK; here Postman posts the webhook instead.
      checkoutUrl: `/api/v1/payments/mock/checkout/${orderId}`,
    }
  },

  verifyWebhook({ rawBody, signature }) {
    if (!signature) return false
    const expected = createHmac("sha256", env.payments.webhookSecret).update(rawBody).digest("hex")
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    return a.length === b.length && timingSafeEqual(a, b)
  },

  parseWebhook(payload) {
    return {
      event: payload.event,
      gatewayRef: payload.payload?.payment?.entity?.id,
      orderId: payload.payload?.payment?.entity?.notes?.orderId,
      amountCents: payload.payload?.payment?.entity?.amount,
    }
  },

  async refund({ gatewayRef, amountCents }) {
    return { refundRef: `mock_rfnd_${randomUUID()}`, gatewayRef, amountCents, status: "refunded" }
  },
}
