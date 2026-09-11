import { prisma } from "../../config/prisma.js"
import { ApiError } from "../../lib/errors.js"
import { logger } from "../../lib/logger.js"

// How long after delivery a piece can be sent back. Kept here as a named constant
// so the window is stated once and both the API and the UI copy agree.
export const RETURN_WINDOW_DAYS = 14

// Orders that are still being paid for, or already cancelled, have nothing to
// return. `fulfilled` is the legacy terminal state and counts as delivered.
const RETURNABLE_ORDER_STATUSES = ["delivered", "fulfilled", "shipped", "paid"]

// A request that is still in play. A *rejected* return is deliberately not here:
// if support turns one down, the shopper is allowed to file again.
const OPEN_RETURN_STATUSES = ["requested", "approved"]

export const REASONS = [
  { value: "too_small", label: "Too small" },
  { value: "too_large", label: "Too large" },
  { value: "not_as_described", label: "Not as described" },
  { value: "damaged", label: "Arrived damaged" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Something else" },
]

export const serializeReturn = (ret) => ({
  id: ret.id,
  // A short human-quotable reference. Support conversations go a lot better when
  // nobody has to read a UUID down the phone.
  reference: `TV-${ret.id.slice(0, 8).toUpperCase()}`,
  type: ret.type,
  reason: ret.reason,
  reasonLabel: REASONS.find((r) => r.value === ret.reason)?.label ?? ret.reason,
  note: ret.note,
  status: ret.status,
  createdAt: ret.createdAt,
  resolvedAt: ret.resolvedAt,
  orderItemId: ret.orderItemId,
  orderId: ret.orderItem?.orderId ?? null,
  item: ret.orderItem
    ? {
        name: ret.orderItem.product?.name ?? null,
        brand: ret.orderItem.product?.brand ?? null,
        image: ret.orderItem.product?.images?.[0]?.url ?? null,
        size: ret.orderItem.size,
        priceCents: ret.orderItem.priceCents,
      }
    : null,
  customer: ret.user ? { id: ret.user.id, name: ret.user.name, email: ret.user.email } : undefined,
})

const returnInclude = {
  orderItem: { include: { product: { include: { images: true } } } },
}

/**
 * Whether a given order item can still be sent back, and if not, why.
 * Returned to the client as well as enforced here, so the UI can explain itself
 * rather than just disabling a button with no reason given.
 */
export const returnEligibility = (orderItem, order, openReturn) => {
  if (openReturn) {
    return { eligible: false, reason: `A ${openReturn.type} is already in progress for this item.` }
  }
  if (!RETURNABLE_ORDER_STATUSES.includes(order.status)) {
    return { eligible: false, reason: "This order isn't eligible for returns." }
  }
  const days = (Date.now() - new Date(order.createdAt).getTime()) / 86400000
  if (days > RETURN_WINDOW_DAYS) {
    return { eligible: false, reason: `The ${RETURN_WINDOW_DAYS}-day return window has closed.` }
  }
  return { eligible: true, reason: null }
}

export const createReturn = async ({ userId, orderItemId, type, reason, note }) => {
  const orderItem = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    include: { order: true },
  })
  if (!orderItem) throw ApiError.notFound("Order item not found")

  // Ownership check first, and phrased as "not found" rather than "forbidden" so
  // this endpoint can't be used to probe whether an item id exists.
  if (orderItem.order.userId !== userId) throw ApiError.notFound("Order item not found")

  const openReturn = await prisma.return.findFirst({
    where: { orderItemId, status: { in: OPEN_RETURN_STATUSES } },
  })

  const { eligible, reason: blockedReason } = returnEligibility(orderItem, orderItem.order, openReturn)
  if (!eligible) throw ApiError.conflict(blockedReason)

  const created = await prisma.return.create({
    data: { orderItemId, userId, type, reason, note: note || null },
    include: returnInclude,
  })

  logger.info("return_requested", { returnId: created.id, type, reason, userId })
  return serializeReturn(created)
}

export const listMyReturns = async (userId) => {
  const rows = await prisma.return.findMany({
    where: { userId },
    include: returnInclude,
    orderBy: { createdAt: "desc" },
  })
  return rows.map(serializeReturn)
}

export const listAllReturns = async (status) => {
  const rows = await prisma.return.findMany({
    where: status ? { status } : {},
    include: { ...returnInclude, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  })
  return rows.map(serializeReturn)
}

/**
 * Admin decision on a return.
 *
 * The important bit is `completed`: once a piece is physically back with us it has
 * to go back on the shelf, or a one-of-one item is lost from the catalogue forever.
 * Refund and exchange both restock — the difference between them is what the
 * customer gets, not whether the garment returns to stock.
 */
export const resolveReturn = async (returnId, status) => {
  return prisma.$transaction(async (tx) => {
    const ret = await tx.return.findUnique({
      where: { id: returnId },
      include: { orderItem: true },
    })
    if (!ret) throw ApiError.notFound("Return not found")
    if (ret.status === "completed") throw ApiError.conflict("This return is already completed")

    if (status === "completed") {
      await tx.product.update({
        where: { id: ret.orderItem.productId },
        data: {
          stockQuantity: { increment: ret.orderItem.qty },
          status: "live",
          version: { increment: 1 },
        },
      })
    }

    const updated = await tx.return.update({
      where: { id: returnId },
      data: {
        status,
        resolvedAt: status === "requested" ? null : new Date(),
      },
      include: { ...returnInclude, user: { select: { id: true, name: true, email: true } } },
    })

    logger.info("return_resolved", {
      returnId,
      status,
      restocked: status === "completed" ? ret.orderItem.qty : 0,
    })
    return serializeReturn(updated)
  })
}
