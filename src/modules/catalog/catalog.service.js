import { prisma } from "../../config/prisma.js"
import { ApiError } from "../../lib/errors.js"
import { productInclude, serializeProduct } from "./product.serializer.js"

const reviewStatsFor = async (productIds) => {
  if (productIds.length === 0) return new Map()
  const grouped = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _avg: { rating: true },
    _count: { rating: true },
  })
  return new Map(
    grouped.map((g) => [
      g.productId,
      { rating: Math.round((g._avg.rating ?? 0) * 10) / 10, count: g._count.rating },
    ])
  )
}

export const listProducts = async ({ category, q, tag, condition, era, page, limit, sort }) => {
  const where = {
    status: "live",
    stockQuantity: { gt: 0 },
    ...(category && category !== "All" ? { category: { name: category } } : {}),
    ...(tag ? { tag } : {}),
    ...(condition ? { condition } : {}),
    ...(era ? { era } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { brand: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const orderBy =
    sort === "price_asc"
      ? { priceCents: "asc" }
      : sort === "price_desc"
        ? { priceCents: "desc" }
        : { createdAt: "desc" }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  const stats = await reviewStatsFor(rows.map((r) => r.id))

  return {
    data: rows.map((row) => serializeProduct(row, stats.get(row.id))),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

export const getProduct = async (id) => {
  const product = await prisma.product.findUnique({ where: { id }, include: productInclude })
  if (!product || product.status === "archived") throw ApiError.notFound("Product not found")

  const stats = await reviewStatsFor([product.id])
  const reviews = await prisma.review.findMany({
    where: { productId: product.id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  })

  // Star histogram for the product page. Counting here rather than in the client
  // means it still adds up if reviews are paginated later.
  const grouped = await prisma.review.groupBy({
    by: ["rating"],
    where: { productId: product.id },
    _count: { rating: true },
  })
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  grouped.forEach((g) => (breakdown[g.rating] = g._count.rating))

  return {
    ...serializeProduct(product, stats.get(product.id)),
    reviewBreakdown: breakdown,
    recentReviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      author: r.user.name,
      createdAt: r.createdAt,
    })),
  }
}

export const listCategories = async () => {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: { where: { status: "live" } } } } },
  })
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    productCount: c._count.products,
  }))
}

export const createReview = async ({ productId, userId, rating, comment }) => {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw ApiError.notFound("Product not found")

  const purchased = await prisma.orderItem.findFirst({
    where: { productId, order: { userId, status: { in: ["paid", "fulfilled"] } } },
  })
  if (!purchased) throw ApiError.forbidden("You can only review items you have purchased")

  const existing = await prisma.review.findUnique({
    where: { productId_userId: { productId, userId } },
  })
  if (existing) throw ApiError.conflict("You have already reviewed this product")

  const review = await prisma.review.create({ data: { productId, userId, rating, comment } })
  return { id: review.id, rating: review.rating, comment: review.comment, createdAt: review.createdAt }
}
