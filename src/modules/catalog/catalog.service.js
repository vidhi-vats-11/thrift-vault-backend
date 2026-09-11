import { prisma } from "../../config/prisma.js"
import { ApiError } from "../../lib/errors.js"
import { productInclude, serializeProduct } from "./product.serializer.js"
import { parseSearchIntent, genderRanker } from "./searchIntent.js"

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

/** One word per field, OR'd across the fields a shopper might have meant. */
const textMatch = (term) => ({
  OR: [
    { name: { contains: term, mode: "insensitive" } },
    { brand: { contains: term, mode: "insensitive" } },
    { description: { contains: term, mode: "insensitive" } },
  ],
})

export const listProducts = async ({
  category,
  q,
  tag,
  condition,
  era,
  page,
  limit,
  sort,
  viewerGender,
}) => {
  const intent = parseSearchIntent(q)

  // An explicit category filter from the UI always wins over one inferred from the
  // query text — the shopper clicked it, so it is not a guess.
  const categoryFilter =
    category && category !== "All"
      ? { category: { name: category } }
      : intent.categories.length > 0
        ? { category: { name: { in: intent.categories } } }
        : {}

  const baseWhere = {
    status: "live",
    stockQuantity: { gt: 0 },
    ...(tag ? { tag } : {}),
    ...(condition ? { condition } : {}),
    ...(era ? { era } : {}),
    ...(intent.maxPrice ? { priceCents: { lte: intent.maxPrice * 100 } } : {}),
  }

  // Leftover words must all match (AND), so "levis jeans" is denim by Levi's rather
  // than denim OR anything Levi's ever made.
  const termFilter = intent.terms.length > 0 ? { AND: intent.terms.map(textMatch) } : {}

  let where = { ...baseWhere, ...categoryFilter, ...termFilter }
  let total = await prisma.product.count({ where })

  // Safety net: the dictionary understood the query (say "jeans") but the leftover
  // words matched nothing. Rather than show an empty grid, drop the words and keep
  // the part we did understand.
  if (total === 0 && intent.matched && intent.terms.length > 0) {
    where = { ...baseWhere, ...categoryFilter }
    total = await prisma.product.count({ where })
  }

  // "newest" is the schema default, i.e. "the shopper did not choose a sort", so a
  // price hint parsed out of the query ("cheap jeans") is allowed to win over it.
  const explicitSort = sort && sort !== "newest" ? sort : intent.sort
  const orderBy =
    explicitSort === "price_asc"
      ? { priceCents: "asc" }
      : explicitSort === "price_desc"
        ? { priceCents: "desc" }
        : { createdAt: "desc" }

  const rank = genderRanker(viewerGender)
  let rows

  if (rank) {
    // Gender PRIORITISES, it never filters — nothing is hidden from anyone. Prisma's
    // orderBy cannot express "these enum values first", so the ordering is done here:
    // pull the matching ids (a narrow, cheap select), stable-sort them by whether the
    // gender is preferred, then page the sorted ids and fetch only that page in full.
    // Sorting in JS *after* paging would be wrong — it would only reorder within a
    // page, which is not the same thing at all.
    const keys = await prisma.product.findMany({
      where,
      select: { id: true, gender: true, priceCents: true, createdAt: true },
    })

    keys.sort((a, b) => {
      if (rank(a.gender) !== rank(b.gender)) return rank(a.gender) - rank(b.gender)
      if (explicitSort === "price_asc") return a.priceCents - b.priceCents
      if (explicitSort === "price_desc") return b.priceCents - a.priceCents
      return b.createdAt - a.createdAt
    })

    const pageIds = keys.slice((page - 1) * limit, page * limit).map((k) => k.id)
    const found = await prisma.product.findMany({
      where: { id: { in: pageIds } },
      include: productInclude,
    })
    // findMany ignores the order of an `in` list, so restore it.
    const byId = new Map(found.map((p) => [p.id, p]))
    rows = pageIds.map((id) => byId.get(id)).filter(Boolean)
  } else {
    rows = await prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    })
  }

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
