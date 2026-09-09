import { prisma } from "../config/prisma.js"
import { logger } from "./logger.js"

// Local dev stub: emails are logged, not sent. Swap this module's internals for an
// SMTP/provider client without touching callers.
const send = ({ to, subject, body }) => {
  logger.info("email_sent", { to, subject, body })
}

export const sendOrderConfirmation = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, items: { include: { product: true } } },
  })
  if (!order) return

  send({
    to: order.user.email,
    subject: `Thrift Vault order ${order.id.slice(0, 8)} confirmed`,
    body: {
      name: order.user.name,
      total: order.totalCents / 100,
      items: order.items.map((i) => `${i.product.name} (${i.size}) x${i.qty}`),
    },
  })
}

export const sendNewsletterWelcome = async (email) => {
  send({ to: email, subject: "Welcome to the Thrift Vault list", body: { email } })
}
