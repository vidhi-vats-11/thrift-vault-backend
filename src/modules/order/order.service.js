import { Prisma } from "@prisma/client"
import { prisma } from "../../config/prisma.js"
import { env } from "../../config/env.js"
import { ApiError } from "../../lib/errors.js"
import { logger } from "../../lib/logger.js"
import { gateway } from "../payment/gateway.js"

const orderInclude = {
  items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" } } } } } },
  payments: { orderBy: { createdAt: "desc" } },
  address: true,
}

export const serializeOrder = (order) => ({
  id: order.id,
  status: order.status,
  subtotalCents: order.subtotalCents,
  totalCents: order.totalCents,
  total: order.totalCents / 100,
  expiresAt: order.expiresAt,
  createdAt: order.createdAt,
  address: order.address ?? null,
  items: order.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    name: item.product.name,
    brand: item.product.brand,
    image: item.product.images?.[0]?.url ?? null,
    size: item.size,
    qty: item.qty,
    priceCents: item.priceCents,
    lineTotalCents: item.priceCents * item.qty,
  })),
  payment: order.payments?.[0]
    ? {
        id: order.payments[0].id,
        gateway: order.payments[0].gateway,
        gatewayRef: order.payments[0].gatewayRef,
        status: order.payments[0].status,
        amountCents: order.payments[0].amountCents,
      }
    : null,
})

export const createOrder = async ({ userId, addressId, idempotencyKey }) => {
  if (idempotencyKey) {
    const replay = await prisma.order.findUnique({
      where: { idempotencyKey },
      include: orderInclude,
    })
    // A retried request returns the original order rather than holding stock twice.
    if (replay) {
      if (replay.userId !== userId) throw ApiError.conflict("Idempotency key already used")
      return { order: serializeOrder(replay), replayed: true }
    }
  }

  if (addressId) {
    const address = await prisma.address.findFirst({ where: { id: addressId, userId } })
    if (!address) throw ApiError.notFound("Address not found")
  }

  const expiresAt = new Date(Date.now() + env.orderHoldMinutes * 60 * 1000)

  const order = await prisma.$transaction(async (tx) => {
    const cartLines = await tx.cartItem.findMany({
      where: { userId },
      include: { product: true },
    })
    if (cartLines.length === 0) throw ApiError.badRequest("Cart is empty")

    // Lock every product row for the life of this transaction, ordered by id so two
    // concurrent checkouts sharing items can never deadlock by grabbing them in
    // opposite orders. This is the guard against selling a stock=1 item twice.
    const productIds = [...new Set(cartLines.map((l) => l.productId))].sort()
    const locked = await tx.$queryRaw`
      SELECT id, name, stock_quantity, status, price_cents
      FROM products
      WHERE id IN (${Prisma.join(productIds)})
      ORDER BY id
      FOR UPDATE
    `

    const lockedById = new Map(locked.map((p) => [p.id, p]))
    const unavailable = []

    for (const line of cartLines) {
      const product = lockedById.get(line.productId)
      if (!product || product.status !== "live" || product.stock_quantity < line.qty) {
        unavailable.push({
          productId: line.productId,
          name: product?.name ?? "Unknown item",
          size: line.size,
          requested: line.qty,
          available: product?.stock_quantity ?? 0,
        })
      }
    }

    if (unavailable.length > 0) {
      throw ApiError.conflict("Some items are no longer available", { unavailable })
    }

    for (const line of cartLines) {
      const product = lockedById.get(line.productId)
      const remaining = product.stock_quantity - line.qty
      await tx.product.update({
        where: { id: line.productId },
        data: {
          stockQuantity: remaining,
          status: remaining === 0 ? "sold" : "live",
          version: { increment: 1 },
        },
      })
    }

    const subtotalCents = cartLines.reduce(
      (sum, line) => sum + lockedById.get(line.productId).price_cents * line.qty,
      0
    )

    const created = await tx.order.create({
      data: {
        userId,
        addressId: addressId ?? null,
        subtotalCents,
        totalCents: subtotalCents,
        status: "pending_payment",
        idempotencyKey: idempotencyKey ?? null,
        expiresAt,
        items: {
          create: cartLines.map((line) => ({
            productId: line.productId,
            size: line.size,
            qty: line.qty,
            priceCents: lockedById.get(line.productId).price_cents,
          })),
        },
      },
      include: orderInclude,
    })

    await tx.cartItem.deleteMany({ where: { userId } })
    return created
  })

  const intent = await gateway.createPaymentIntent({
    orderId: order.id,
    amountCents: order.totalCents,
  })

  await prisma.payment.create({
    data: {
      orderId: order.id,
      gateway: gateway.name,
      gatewayRef: intent.gatewayRef,
      status: "created",
      amountCents: order.totalCents,
    },
  })

  const withPayment = await prisma.order.findUnique({
    where: { id: order.id },
    include: orderInclude,
  })

  logger.info("order_created", { orderId: order.id, userId, totalCents: order.totalCents })

  return { order: serializeOrder(withPayment), paymentIntent: intent, replayed: false }
}

export const getOrder = async (userId, orderId) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: orderInclude,
  })
  if (!order) throw ApiError.notFound("Order not found")
  return serializeOrder(order)
}

export const listOrders = async (userId) => {
  const orders = await prisma.order.findMany({
    where: { userId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  })
  return orders.map(serializeOrder)
}

// Returns stock to the catalog for a cancelled/expired order. Safe to call once per order;
// the status guard inside the transaction keeps a double call from inflating stock.
export const releaseOrder = async (orderId, reason) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
    if (!order || order.status !== "pending_payment") return null

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: { increment: item.qty },
          status: "live",
          version: { increment: 1 },
        },
      })
    }

    const cancelled = await tx.order.update({
      where: { id: orderId },
      data: { status: "cancelled" },
    })

    logger.info("order_released", { orderId, reason })
    return cancelled
  })
}

export const cancelOrder = async (userId, orderId) => {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId } })
  if (!order) throw ApiError.notFound("Order not found")
  if (order.status !== "pending_payment") {
    throw ApiError.conflict(`Cannot cancel an order in status "${order.status}"`)
  }
  await releaseOrder(orderId, "cancelled_by_user")
  return getOrder(userId, orderId)
}
