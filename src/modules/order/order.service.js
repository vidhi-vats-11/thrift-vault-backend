import { Prisma } from "@prisma/client"
import { prisma } from "../../config/prisma.js"
import { env } from "../../config/env.js"
import { ApiError } from "../../lib/errors.js"
import { logger } from "../../lib/logger.js"
import { gateway } from "../payment/gateway.js"
// One-way import: return.service knows nothing about order.service, so the
// eligibility rule lives in one place without creating a cycle.
import { returnEligibility } from "./return.service.js"

// How long after payment we promise delivery. A single named constant so the
// customer's "arriving by" and the admin's default ETA can never disagree.
export const DELIVERY_DAYS = 5

export const estimateDelivery = (from = new Date()) =>
  new Date(from.getTime() + DELIVERY_DAYS * 86400000)

const orderInclude = {
  items: {
    include: {
      product: { include: { images: { orderBy: { sortOrder: "asc" } } } },
      // Pulled in so each line can say whether it is already being returned, and
      // whether a new return is still allowed — the Orders page needs both to
      // decide between a "Return or exchange" button and a status badge.
      returns: { orderBy: { createdAt: "desc" } },
    },
  },
  payments: { orderBy: { createdAt: "desc" } },
  address: true,
  events: { orderBy: { createdAt: "desc" } },
}

/**
 * Per-line return state for the Orders page.
 *
 * Computed on the server rather than in React so the button the shopper sees and
 * the rule the API enforces can never disagree — the UI simply renders whatever
 * this says. `returnBlockedReason` exists so a disabled button can explain itself
 * instead of just looking broken.
 */
const returnStateFor = (item, order) => {
  const open = (item.returns ?? []).find((r) => r.status === "requested" || r.status === "approved")
  const latest = (item.returns ?? [])[0] ?? null
  const { eligible, reason } = returnEligibility(item, order, open)
  return {
    canReturn: eligible,
    returnBlockedReason: reason,
    activeReturn: latest
      ? {
          id: latest.id,
          reference: `TV-${latest.id.slice(0, 8).toUpperCase()}`,
          type: latest.type,
          status: latest.status,
          createdAt: latest.createdAt,
        }
      : null,
  }
}

export const serializeOrder = (order) => ({
  id: order.id,
  status: order.status,
  subtotalCents: order.subtotalCents,
  totalCents: order.totalCents,
  total: order.totalCents / 100,
  expiresAt: order.expiresAt,
  createdAt: order.createdAt,
  expectedDeliveryAt: order.expectedDeliveryAt ?? null,
  shippedAt: order.shippedAt ?? null,
  deliveredAt: order.deliveredAt ?? null,
  // Newest first, which is how a tracking page reads — latest position at the top.
  events: (order.events ?? []).map((e) => ({
    id: e.id,
    label: e.label,
    location: e.location,
    createdAt: e.createdAt,
  })),
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
    ...returnStateFor(item, order),
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
/**
 * Returns an order's stock to the catalogue and marks it cancelled.
 *
 * `allowedStatuses` defaults to pending_payment only, and that default is load-
 * bearing: jobs/releaseExpiredOrders.js sweeps on a timer, and if it could touch
 * paid orders it would quietly cancel real purchases. Only the explicit user-cancel
 * path widens it. Safe to call twice — the status guard inside the transaction is
 * what stops a double call from inflating stock.
 *
 * Deliberately does NOT refund. Money is handled by the caller (cancelOrder), so
 * the timer-driven sweep can never trigger a payment operation.
 */
export const releaseOrder = async (orderId, reason, allowedStatuses = ["pending_payment"]) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
    if (!order || !allowedStatuses.includes(order.status)) return null

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

    // Written in the same transaction as the status change so the customer's
    // tracking history can never disagree with the order's actual state.
    await tx.orderEvent.create({
      data: { orderId, label: EVENT_LABELS.cancelled },
    })

    logger.info("order_released", { orderId, reason, fromStatus: order.status })
    return cancelled
  })
}

// Default wording for each milestone, so an admin who just flips the status still
// produces a readable tracking line instead of a bare enum name.
const EVENT_LABELS = {
  paid: "Payment confirmed",
  shipped: "Dispatched from our studio",
  delivered: "Delivered",
  fulfilled: "Delivered",
  cancelled: "Order cancelled",
}

/**
 * Moves an order to a new status and records the journey.
 *
 * Status and history are written together in one transaction: a parcel that is
 * marked shipped but has no "dispatched" line, or vice versa, would make the
 * customer's tracking page contradict the admin's. Milestone timestamps are
 * stamped here rather than trusted from the client.
 */
export const setOrderStatus = async (orderId, status, { location, note } = {}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) throw ApiError.notFound("Order not found")

    const data = { status }
    if (status === "shipped" && !order.shippedAt) {
      data.shippedAt = new Date()
      // Only promise a date once the parcel is actually moving, and don't
      // overwrite a date an admin has already set by hand.
      if (!order.expectedDeliveryAt) data.expectedDeliveryAt = estimateDelivery()
    }
    if ((status === "delivered" || status === "fulfilled") && !order.deliveredAt) {
      data.deliveredAt = new Date()
    }

    await tx.order.update({ where: { id: orderId }, data })
    await tx.orderEvent.create({
      data: {
        orderId,
        label: note?.trim() || EVENT_LABELS[status] || `Status changed to ${status}`,
        location: location?.trim() || null,
      },
    })

    logger.info("order_status_changed", { orderId, status, location: location ?? null })
    return tx.order.findUnique({ where: { id: orderId }, include: orderInclude })
  })
}

/** A tracking line that doesn't change the status — "Reached Mumbai hub". */
export const addOrderEvent = async (orderId, { label, location }) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) throw ApiError.notFound("Order not found")

  await prisma.orderEvent.create({
    data: { orderId, label: label.trim(), location: location?.trim() || null },
  })
  return prisma.order.findUnique({ where: { id: orderId }, include: orderInclude })
}

// A shopper can call the order off right up until it physically leaves us. Once it
// is shipped the garment is in transit, so undoing the sale is a return — a
// different flow, with a different conversation about who pays the postage.
export const CANCELLABLE_STATUSES = ["pending_payment", "paid"]

export const cancelOrder = async (userId, orderId) => {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId } })
  if (!order) throw ApiError.notFound("Order not found")

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    // Say what to do instead, rather than just refusing — "cannot cancel" with no
    // alternative is how a shopper ends up emailing support.
    if (order.status === "shipped" || order.status === "delivered" || order.status === "fulfilled") {
      throw ApiError.conflict(
        "This order has already been dispatched, so it can't be cancelled — request a return or exchange on the item instead."
      )
    }
    if (order.status === "cancelled") {
      throw ApiError.conflict("This order is already cancelled.")
    }
    throw ApiError.conflict(`Cannot cancel an order in status "${order.status}"`)
  }

  // Money first, stock second. If the restock failed after a refund the shopper is
  // whole and we have a visible stuck order; the reverse would take their money and
  // hand the piece to someone else. Mirrors the admin refund route's ordering.
  const captured = await prisma.payment.findFirst({
    where: { orderId, status: "captured" },
  })
  if (captured) {
    await gateway.refund({
      gatewayRef: captured.gatewayRef,
      amountCents: captured.amountCents,
    })
    await prisma.payment.update({ where: { id: captured.id }, data: { status: "refunded" } })
    logger.info("order_refunded_on_cancel", {
      orderId,
      gatewayRef: captured.gatewayRef,
      amountCents: captured.amountCents,
    })
  }

  await releaseOrder(orderId, "cancelled_by_user", CANCELLABLE_STATUSES)
  return getOrder(userId, orderId)
}
