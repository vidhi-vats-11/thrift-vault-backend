import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import {
  CATEGORIES,
  IMAGE_ANGLES,
  PRODUCTS,
  REVIEWER_NAMES,
  REVIEW_CONTENT,
} from "./seedData.js"

const prisma = new PrismaClient()

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

// Deterministic PRNG so re-seeding produces the same catalogue and reviews.
const makeRandom = (seed) => {
  let h = 2166136261 ^ seed.length
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)]

/**
 * Star distribution of `count` reviews averaging `target`. Mostly shaves one star
 * at a time (which fills the 4-star bucket) with the occasional bigger bite so the
 * histogram keeps a realistic low-star tail.
 */
const buildRatings = (count, target, rand) => {
  const ratings = new Array(count).fill(5)
  let deficit = 5 * count - Math.round(target * count)
  let guard = count * 20

  while (deficit > 0 && guard-- > 0) {
    const i = Math.floor(rand() * count)
    if (ratings[i] <= 1) continue
    const bite = rand() > 0.85 ? 2 + Math.floor(rand() * 3) : 1
    const applied = Math.min(bite, deficit, ratings[i] - 1)
    ratings[i] -= applied
    deficit -= applied
  }
  return ratings
}

const seedCategories = async () => {
  for (const name of CATEGORIES) {
    await prisma.category.upsert({
      where: { name },
      create: { name, slug: slugify(name) },
      update: {},
    })
  }
  return new Map((await prisma.category.findMany()).map((c) => [c.name, c.id]))
}

const seedProducts = async (categories) => {
  const bySeed = new Map()

  for (const item of PRODUCTS) {
    const images = IMAGE_ANGLES.map((angle, sortOrder) => ({
      url: `https://picsum.photos/seed/${item.seed}${angle}/900/1125`,
      sortOrder,
    }))

    const fields = {
      name: item.name,
      brand: item.brand,
      categoryId: categories.get(item.category),
      priceCents: item.price * 100,
      originalPriceCents: item.originalPrice * 100,
      condition: item.condition,
      era: item.era,
      tag: item.tag,
      description: item.description,
      highlights: item.highlights,
      // Stored as an ordered array, not an object: Postgres JSONB does not preserve
      // key order, and the spec table reads best in a deliberate sequence
      // (material → fit → colour → measurements → care).
      details: Object.entries(item.details).map(([label, value]) => ({ label, value })),
      flaws: item.flaws,
    }

    const existing = await prisma.product.findFirst({ where: { name: item.name } })

    let product
    if (existing) {
      // Refresh the copy but leave stock/status alone, so re-seeding doesn't
      // resurrect items someone already bought in a running demo. Run with
      // RESTOCK=1 to put everything back on the shelf (see npm run seed:restock).
      const restock = process.env.RESTOCK === "1"
      product = await prisma.product.update({
        where: { id: existing.id },
        data: restock ? { ...fields, stockQuantity: 1, status: "live" } : fields,
      })
      await prisma.productImage.deleteMany({ where: { productId: product.id } })
      await prisma.productImage.createMany({
        data: images.map((img) => ({ ...img, productId: product.id })),
      })
      await prisma.productSize.deleteMany({ where: { productId: product.id } })
      await prisma.productSize.createMany({
        data: item.sizes.map((size) => ({ size, productId: product.id })),
        skipDuplicates: true,
      })
    } else {
      product = await prisma.product.create({
        data: {
          ...fields,
          // One-of-one secondhand stock, per the tech doc's core constraint.
          stockQuantity: 1,
          sizes: { create: item.sizes.map((size) => ({ size })) },
          images: { create: images },
        },
      })
    }

    bySeed.set(item.seed, product)
  }

  return bySeed
}

// Reviewers are real user rows because Review.userId is a foreign key. They share
// one password hash so seeding stays fast (bcrypt at cost 12 is deliberately slow).
const seedReviewers = async (passwordHash) => {
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: "reviewer" } },
    select: { id: true, email: true },
  })
  const byEmail = new Map(existing.map((u) => [u.email, u.id]))

  const missing = REVIEWER_NAMES.map((name, i) => ({
    email: `reviewer${i + 1}@thriftvault.test`,
    name,
    passwordHash,
  })).filter((u) => !byEmail.has(u.email))

  if (missing.length > 0) {
    await prisma.user.createMany({ data: missing, skipDuplicates: true })
  }

  const all = await prisma.user.findMany({
    where: { email: { startsWith: "reviewer" } },
    orderBy: { email: "asc" },
    select: { id: true },
  })
  return all.map((u) => u.id)
}

const seedReviews = async (productsBySeed, reviewerIds) => {
  let written = 0

  for (const item of PRODUCTS) {
    const product = productsBySeed.get(item.seed)

    const already = await prisma.review.count({ where: { productId: product.id } })
    if (already > 0) continue // don't duplicate on re-seed

    const rand = makeRandom(item.seed)
    const count = Math.min(item.reviewCount, reviewerIds.length)
    const ratings = buildRatings(count, item.rating, rand)

    // Shuffle reviewers deterministically so each product gets a different set
    const shuffled = [...reviewerIds]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    const now = Date.now()
    const rows = ratings.map((rating, i) => ({
      productId: product.id,
      userId: shuffled[i],
      rating,
      comment: pick(REVIEW_CONTENT[rating], rand),
      createdAt: new Date(now - (Math.floor(rand() * 600) + 3) * 86400000),
    }))

    await prisma.review.createMany({ data: rows, skipDuplicates: true })
    written += rows.length
  }

  return written
}

const main = async () => {
  const categories = await seedCategories()
  const productsBySeed = await seedProducts(categories)

  const passwordHash = await bcrypt.hash("Password123!", 12)

  await prisma.user.upsert({
    where: { email: "admin@thriftvault.test" },
    create: {
      email: "admin@thriftvault.test",
      name: "Vault Admin",
      role: "admin",
      passwordHash,
    },
    update: { role: "admin" },
  })

  await prisma.user.upsert({
    where: { email: "shopper@thriftvault.test" },
    create: { email: "shopper@thriftvault.test", name: "Test Shopper", passwordHash },
    update: {},
  })

  const reviewerIds = await seedReviewers(passwordHash)
  const reviewsWritten = await seedReviews(productsBySeed, reviewerIds)

  console.log("Seed complete:", {
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    images: await prisma.productImage.count(),
    users: await prisma.user.count(),
    reviews: await prisma.review.count(),
    reviewsWrittenThisRun: reviewsWritten,
  })
  console.log("Admin login:   admin@thriftvault.test / Password123!")
  console.log("Shopper login: shopper@thriftvault.test / Password123!")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
