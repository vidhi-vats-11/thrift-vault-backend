import { prisma } from "../../config/prisma.js"
import { ApiError } from "../../lib/errors.js"
import { productInclude, serializeProduct } from "../catalog/product.serializer.js"

const serializeLine = (line) => ({
  id: line.id,
  productId: line.productId,
  size: line.size,
  qty: line.qty,
  unitPriceCents: line.product.priceCents,
  lineTotalCents: line.product.priceCents * line.qty,
  available: line.product.status === "live" && line.product.stockQuantity >= line.qty,
  product: serializeProduct(line.product),
  addedAt: line.addedAt,
})

export const getCart = async (userId) => {
  const lines = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: { include: productInclude } },
    orderBy: { addedAt: "desc" },
  })

  const items = lines.map(serializeLine)
  const subtotalCents = items
    .filter((i) => i.available)
    .reduce((sum, i) => sum + i.lineTotalCents, 0)

  return { items, subtotalCents, subtotal: subtotalCents / 100, itemCount: items.length }
}

const assertSellable = async (productId, size, qty) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { sizes: true },
  })
  if (!product || product.status !== "live") throw ApiError.notFound("Product is not available")
  if (product.stockQuantity < qty) {
    throw ApiError.conflict("Requested quantity exceeds available stock", {
      available: product.stockQuantity,
    })
  }
  if (product.sizes.length > 0 && !product.sizes.some((s) => s.size === size)) {
    throw ApiError.badRequest(`Size "${size}" is not offered for this product`)
  }
}

export const addItem = async (userId, { productId, size, qty }) => {
  await assertSellable(productId, size, qty)

  // Adding to cart deliberately does not reserve stock (tech doc §4.3) — the hold
  // happens at order creation, since carts can sit idle for days.
  await prisma.cartItem.upsert({
    where: { userId_productId_size: { userId, productId, size } },
    create: { userId, productId, size, qty },
    update: { qty: { increment: qty } },
  })

  return getCart(userId)
}

export const updateItem = async (userId, itemId, qty) => {
  const line = await prisma.cartItem.findFirst({ where: { id: itemId, userId } })
  if (!line) throw ApiError.notFound("Cart item not found")

  await assertSellable(line.productId, line.size, qty)
  await prisma.cartItem.update({ where: { id: itemId }, data: { qty } })
  return getCart(userId)
}

export const removeItem = async (userId, itemId) => {
  const { count } = await prisma.cartItem.deleteMany({ where: { id: itemId, userId } })
  if (count === 0) throw ApiError.notFound("Cart item not found")
  return getCart(userId)
}

export const clearCart = async (userId) => {
  await prisma.cartItem.deleteMany({ where: { userId } })
  return getCart(userId)
}

// Called once on login with the guest cart the SPA held in localStorage.
export const mergeCart = async (userId, items) => {
  const skipped = []

  for (const item of items) {
    try {
      await assertSellable(item.productId, item.size, item.qty)
    } catch (err) {
      skipped.push({ productId: item.productId, size: item.size, reason: err.message })
      continue
    }

    const existing = await prisma.cartItem.findUnique({
      where: { userId_productId_size: { userId, productId: item.productId, size: item.size } },
    })

    // Take the larger qty rather than summing, so a repeated merge is idempotent.
    await prisma.cartItem.upsert({
      where: { userId_productId_size: { userId, productId: item.productId, size: item.size } },
      create: { userId, productId: item.productId, size: item.size, qty: item.qty },
      update: { qty: Math.max(existing?.qty ?? 0, item.qty) },
    })
  }

  return { ...(await getCart(userId)), skipped }
}
