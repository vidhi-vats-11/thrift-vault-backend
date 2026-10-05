/**
 * Bulk demo dataset — ~1000 orders and the catalogue, accounts and payment
 * history needed to make them real.
 *
 * Why this exists separately from seed.js: seed.js lays down the *curated*
 * catalogue — 52 hand-written listings with real photographs. This script
 * builds volume on top of it, so the admin dashboard, order history, revenue
 * figures and tracking pages have something substantial to render.
 *
 * Three constraints shaped the design:
 *
 * 1. Every piece is one-of-one. An order line cannot share a product with any
 *    other order line, so ~1000 orders need ~1350 distinct products. The
 *    catalogue is sized from the order book, not guessed at.
 *
 * 2. Photos must match names. There is no image service that returns a garment
 *    by keyword (loremflickr is dead, picsum is random), so every generated
 *    listing is a *variant of one of the 52 real archetypes* and inherits that
 *    archetype's real photograph. The name is built from the archetype's own
 *    noun phrase, which is what keeps the two in agreement: a listing called
 *    "90s Faded Denim Trucker Jacket" carries the real trucker-jacket photo.
 *    The cost is that photos repeat across variants.
 *
 * 3. Rows must satisfy the same invariants the API would have produced. Status,
 *    stock, payment state, milestone timestamps and tracking events are written
 *    the way order.service.js writes them — a shipped order always has a
 *    shippedAt and a "Dispatched from our studio" event, a cancelled order has
 *    its stock back, a refund only exists where a capture did. Order dates are
 *    conditioned on status for the same reason: an order still sitting in
 *    `shipped` eight months on would be a data bug, not a demo.
 *
 * Usage:
 *   node prisma/seedBulk.js            # generate (refuses if data exists)
 *   node prisma/seedBulk.js --reset    # delete previous generation, regenerate
 *   SCALE=0.1 node prisma/seedBulk.js  # a tenth of everything, for a quick run
 */

import { randomUUID } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import { PRODUCTS, REVIEW_CONTENT } from "./seedData.js"

const prisma = new PrismaClient()

// Optional bank of extra photographs per archetype, built by fetchPhotos.js.
// Without it every variant falls back to its archetype's single curated shot,
// which works but repeats the same picture across ~33 listings.
const POOL_PATH = join(dirname(fileURLToPath(import.meta.url)), "photoPool.json")
const PHOTO_POOL = existsSync(POOL_PATH) ? JSON.parse(readFileSync(POOL_PATH, "utf8")) : {}

const SCALE = Number(process.env.SCALE ?? 1)
const RESET = process.argv.includes("--reset")

// Order counts per status. Deliberately explicit rather than percentages: the
// totals are what the dashboards show, so they should be readable here.
const ORDER_MIX = {
  fulfilled: 400,
  delivered: 245,
  cancelled: 152,
  paid: 100,
  shipped: 95,
  // Checkouts still in flight. Small on purpose — the hold is 15 minutes and the
  // release sweep runs daily, so only about a day's worth can legitimately be
  // sitting here. Abandoned checkouts from further back show up as `cancelled`,
  // which is where the sweep puts them.
  pending_payment: 8,
}

const SHOPPERS = 320
const EXTRA_LIVE_PRODUCTS = 220 // browsable stock on top of the 52 curated ones
const NEWSLETTER_SUBSCRIBERS = 480

const scaled = (n) => Math.max(1, Math.round(n * SCALE))

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

// Same PRNG as seed.js, so a given SCALE always produces the same dataset and
// diffs between runs mean a real change rather than fresh randomness.
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

const rand = makeRandom("thrift-vault-bulk-v1")
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const int = (min, max) => min + Math.floor(rand() * (max - min + 1))
const chance = (p) => rand() < p
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const DAY = 86400000
const daysAgo = (d) => new Date(Date.now() - d * DAY)
const plusDays = (date, d) => new Date(date.getTime() + d * DAY)
const plusMinutes = (date, m) => new Date(date.getTime() + m * 60000)
/** A random instant between `from` and `to` days ago. */
const between = (fromDays, toDays) => daysAgo(toDays + rand() * (fromDays - toDays))

/**
 * An instant `minDays`-`maxDays` after `start`, never later than now. Returns
 * null when even the minimum delay would land in the future — which is how a
 * recently-delivered order correctly ends up with no review and no return
 * rather than one dated next week.
 */
const afterWithin = (start, minDays, maxDays) => {
  const earliest = start.getTime() + minDays * DAY
  const latest = Math.min(start.getTime() + maxDays * DAY, Date.now())
  if (earliest > latest) return null
  return new Date(earliest + rand() * (latest - earliest))
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Era tokens double as the `era` column value when one is used as a name prefix,
// so a listing never claims to be 90s in its name and Modern in its data.
// Decades set the `era` column when used as a prefix. "Vintage"/"Retro" name no
// decade, so they leave the column alone — which also means they must not be
// applied to a Modern-era archetype, or the listing would read "Retro ..." while
// its era said Modern.
const ERA_DECADES = ["70s", "80s", "90s", "Y2K", "00s"]
const ERA_VAGUE = ["Vintage", "Retro"]
// Wear words have to suit the material. "Washed" is fine for a flannel, wrong
// for a leather belt and nonsense for a wristwatch, so the pool is chosen from
// what the garment is actually made of.
const FLAVOURS_BY_MATERIAL = {
  textile: ["Archive", "Faded", "Washed", "Soft-Washed", "Sun-Faded", "Well-Worn", "Broken-In", "Lived-In", "Deadstock", "Reworked", "Second-Season", "Thrifted", "Pre-Loved"],
  leather: ["Archive", "Faded", "Sun-Faded", "Well-Worn", "Broken-In", "Lived-In", "Deadstock", "Reworked", "Second-Season", "Thrifted", "Pre-Loved"],
  hard: ["Archive", "Deadstock", "Serviced", "Second-Season", "Thrifted", "Pre-Loved"],
}

const MATERIAL_KEYWORDS = [
  { material: "hard", match: ["watch", "sunglasses", "necklace"] },
  { material: "leather", match: ["leather", "boots", "brogue", "belt", "tote", "crossbody", "nubuck"] },
]

// Cut and fit only mean something for clothing — a "Relaxed-Fit" pair of
// sunglasses is not a listing anyone would write.
const FIT_PREFIXES = ["Oversized", "Boxy", "Relaxed-Fit", "Cropped"]
const FITTED_CATEGORIES = new Set(["Jackets", "Denim", "Tops", "Dresses", "Bottoms", "Knitwear"])

// Tokens that mean a prefix of the same kind would contradict the core name —
// "Oversized Cropped Graphic Tee" or "90s Y2K Windbreaker".
const ERA_TOKENS = ["70s", "80s", "90s", "00s", "y2k", "2000s", "vintage", "retro", "modern"]
const FIT_TOKENS = [
  "oversized", "boxy", "cropped", "baggy", "relaxed", "slim", "wide-leg",
  "low-rise", "chunky", "tapered", "pleated", "straight-leg", "mini", "midi",
]

// Category is too coarse a key for brands. "Accessories" spans watches, scarves,
// bags and sunglasses, and picking from one pool produced listings like a Seiko
// wool scarf. These are matched against the archetype's name first, and only
// fall through to the category pool when nothing matches.
const BRANDS_BY_KEYWORD = [
  // Outerwear is the worst offender for this: an Adidas denim trucker or a North
  // Face leather biker reads as obviously fake.
  { match: ["trucker"], brands: ["Levi's", "Wrangler", "Lee", "Carhartt", "Gap"] },
  { match: ["biker", "leather jacket"], brands: ["Schott NYC", "AllSaints", "Avirex", "Belstaff"] },
  { match: ["bomber"], brands: ["Alpha Industries", "Avirex", "Schott NYC", "Adidas"] },
  { match: ["varsity"], brands: ["Champion", "Nike", "Ralph Lauren", "Russell Athletic"] },
  { match: ["puffer", "down"], brands: ["The North Face", "Columbia", "Patagonia", "Uniqlo"] },
  { match: ["trench", "overcoat"], brands: ["Burberry", "Aquascutum", "Jaeger", "Zara"] },
  { match: ["blazer", "suit"], brands: ["Hugo Boss", "Ralph Lauren", "Jaeger", "Zara"] },
  { match: ["windbreaker"], brands: ["Nike ACG", "Adidas", "Umbro", "Columbia"] },
  { match: ["flannel"], brands: ["Carhartt", "Dickies", "Wrangler", "Woolrich"] },
  { match: ["hoodie", "sweatshirt"], brands: ["Champion", "Nike", "Adidas", "Carhartt", "Russell Athletic"] },
  { match: ["polo"], brands: ["Ralph Lauren", "Lacoste", "Fred Perry"] },
  { match: ["henley", "overshirt"], brands: ["Uniqlo", "Gap", "COS"] },
  { match: ["satin shirt", "gown", "sundress", "mini dress"], brands: ["Zara", "Mango", "Laura Ashley", "Karen Millen"] },
  { match: ["carpenter"], brands: ["Dickies", "Carhartt", "Levi's"] },
  { match: ["mom jeans", "straight-leg jeans", "denim shorts"], brands: ["Levi's", "Wrangler", "Lee"] },
  { match: ["cargo"], brands: ["Dickies", "Carhartt", "Alpha Industries"] },
  { match: ["trousers"], brands: ["Ralph Lauren", "Burberry", "Uniqlo", "Jaeger"] },
  { match: ["skirt"], brands: ["Zara", "Mango", "Topshop"] },
  { match: ["cardigan", "sweater"], brands: ["Ralph Lauren", "Benetton", "Pringle of Scotland", "Woolrich", "Gap"] },
  { match: ["watch"], brands: ["Seiko", "Casio", "Citizen", "Timex", "Fossil", "Skagen"] },
  { match: ["sunglasses"], brands: ["Ray-Ban", "Oakley", "Persol", "Police"] },
  { match: ["necklace"], brands: ["Accessorize", "Monet", "Trifari", "Zara"] },
  { match: ["tote", "crossbody", "bag"], brands: ["Coach", "Mulberry", "Fossil", "Michael Kors", "Zara"] },
  { match: ["scarf"], brands: ["Burberry", "Uniqlo", "Acne Studios", "Woolrich", "Barbour"] },
  { match: ["beanie"], brands: ["Carhartt", "Uniqlo", "The North Face", "Woolrich"] },
  { match: ["bucket hat", "baseball cap", "cap"], brands: ["Kangol", "Nike", "New Era", "Carhartt", "Stussy"] },
  { match: ["belt"], brands: ["Levi's", "Coach", "Ralph Lauren", "Fossil"] },
  { match: ["sneakers", "high-tops"], brands: ["Nike", "Adidas", "Converse", "New Balance", "Vans", "Reebok"] },
  { match: ["brogue"], brands: ["Clarks", "Loake", "Barker"] },
  { match: ["boots"], brands: ["Dr. Martens", "Timberland", "Clarks", "Red Wing", "Blundstone"] },
]

const BRANDS_BY_CATEGORY = {
  Jackets: ["Nike ACG", "Levi's", "Schott NYC", "Carhartt WIP", "The North Face", "Adidas", "Columbia", "Members Only", "Avirex", "Woolrich"],
  Denim: ["Levi's", "Wrangler", "Lee", "Dickies", "Carhartt", "Diesel", "Guess", "Edwin"],
  Tops: ["Champion", "Nike", "Adidas", "Ralph Lauren", "Tommy Hilfiger", "Lacoste", "Stussy", "Carhartt", "Fruit of the Loom", "Gap"],
  Dresses: ["Laura Ashley", "Zara", "Mango", "Jigsaw", "Monsoon", "Karen Millen"],
  Bottoms: ["Dickies", "Carhartt", "Levi's", "Ralph Lauren", "Uniqlo", "Burberry", "Gap"],
  Footwear: ["Nike", "Adidas", "Dr. Martens", "Converse", "Clarks", "Timberland", "New Balance", "Red Wing"],
  Knitwear: ["Ralph Lauren", "Gap", "Benetton", "Woolrich", "Pringle of Scotland", "Uniqlo", "Aran Crafts"],
  Accessories: ["Coach", "Ray-Ban", "Fossil", "Seiko", "Casio", "Kangol", "Mulberry", "Nike", "Burberry"],
}

// Condition drives both price and the flaws line, so the two can never disagree.
// `multiplier` is applied to the archetype's price.
const CONDITIONS = [
  { name: "Like New", weight: 14, multiplier: 1.25, flaws: "None to note — about as close to deadstock as secondhand gets." },
  { name: "Excellent", weight: 22, multiplier: 1.1, flaws: "Very light wear only, nothing visible once it's on." },
  { name: "Very Good", weight: 28, multiplier: 0.95, flaws: "Softening at the seams and a touch of fading. No holes, no stains." },
  { name: "Good", weight: 26, multiplier: 0.8, flaws: "Honest wear for its age — some fading and light pilling, nothing structural." },
  { name: "Fair", weight: 10, multiplier: 0.6, flaws: "Visible wear: fading throughout and a small mark near the hem. Priced for it." },
]

// Only the four tags ProductCard styles, plus no tag at all for most listings.
const TAGS = [null, null, null, null, null, null, "RARE FIND", "NEW DROP", "ONE OF ONE", "TRENDING"]

const FIRST_NAMES = [
  "Aarav", "Aditi", "Advait", "Ananya", "Anirudh", "Anjali", "Arjun", "Avni", "Bhavya", "Chaitanya",
  "Darshan", "Devika", "Dhruv", "Diya", "Esha", "Farhan", "Gauri", "Harsh", "Ira", "Ishaan",
  "Jahnavi", "Kabir", "Kavya", "Keshav", "Lakshya", "Maitri", "Manav", "Meera", "Mihir", "Naina",
  "Neel", "Nikhil", "Nitya", "Omkar", "Pari", "Parth", "Prisha", "Rahul", "Raghav", "Riya",
  "Rohan", "Saanvi", "Sahil", "Samar", "Sanya", "Shaurya", "Shreya", "Siddharth", "Tanvi", "Tara",
  "Uday", "Vaishnavi", "Varun", "Vedant", "Vihaan", "Yash", "Zara", "Ayesha", "Imran", "Kiara",
]
const LAST_NAMES = [
  "Agarwal", "Bhatia", "Chatterjee", "Desai", "Dutta", "Gupta", "Iyer", "Jain", "Joshi", "Kapoor",
  "Khanna", "Kulkarni", "Malhotra", "Mehta", "Menon", "Mishra", "Nair", "Pandey", "Patel", "Pillai",
  "Rao", "Reddy", "Saxena", "Sharma", "Shetty", "Singh", "Sinha", "Thakur", "Trivedi", "Verma",
]

// Shipping geography. The courier hub in each row is what tracking events quote,
// so a parcel to Pune is never scanned in Guwahati.
const CITIES = [
  { city: "Mumbai", state: "Maharashtra", pin: "4000", hub: "Mumbai" },
  { city: "Pune", state: "Maharashtra", pin: "4110", hub: "Mumbai" },
  { city: "Delhi", state: "Delhi", pin: "1100", hub: "Delhi" },
  { city: "Gurugram", state: "Haryana", pin: "1220", hub: "Delhi" },
  { city: "Noida", state: "Uttar Pradesh", pin: "2013", hub: "Delhi" },
  { city: "Bengaluru", state: "Karnataka", pin: "5600", hub: "Bengaluru" },
  { city: "Mysuru", state: "Karnataka", pin: "5700", hub: "Bengaluru" },
  { city: "Hyderabad", state: "Telangana", pin: "5000", hub: "Hyderabad" },
  { city: "Chennai", state: "Tamil Nadu", pin: "6000", hub: "Chennai" },
  { city: "Coimbatore", state: "Tamil Nadu", pin: "6410", hub: "Chennai" },
  { city: "Kolkata", state: "West Bengal", pin: "7000", hub: "Kolkata" },
  { city: "Ahmedabad", state: "Gujarat", pin: "3800", hub: "Ahmedabad" },
  { city: "Surat", state: "Gujarat", pin: "3950", hub: "Ahmedabad" },
  { city: "Jaipur", state: "Rajasthan", pin: "3020", hub: "Delhi" },
  { city: "Lucknow", state: "Uttar Pradesh", pin: "2260", hub: "Delhi" },
  { city: "Indore", state: "Madhya Pradesh", pin: "4520", hub: "Mumbai" },
  { city: "Bhopal", state: "Madhya Pradesh", pin: "4620", hub: "Mumbai" },
  { city: "Chandigarh", state: "Chandigarh", pin: "1600", hub: "Delhi" },
  { city: "Kochi", state: "Kerala", pin: "6820", hub: "Bengaluru" },
  { city: "Guwahati", state: "Assam", pin: "7810", hub: "Kolkata" },
]
const STREETS = [
  "Linking Road", "MG Road", "Hill Road", "Park Street", "Brigade Road", "Residency Road",
  "Anna Salai", "Banjara Hills", "Civil Lines", "Model Town", "Koregaon Park", "Lajpat Nagar",
  "Sector 18", "Indiranagar 100ft Road", "Jubilee Hills", "Salt Lake Sector V",
]

const RETURN_REASONS = ["too_small", "too_large", "not_as_described", "damaged", "changed_mind", "other"]
const RETURN_NOTES = {
  too_small: "Lovely piece but I can't get it across the shoulders.",
  too_large: "Much roomier than the flat measurements suggested.",
  not_as_described: "The fade is a lot heavier in person than the photos show.",
  damaged: "Small tear along the inside seam that wasn't in the condition notes.",
  changed_mind: "Bought two in the same drop and only need one.",
  other: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const weightedCondition = () => {
  const total = CONDITIONS.reduce((s, c) => s + c.weight, 0)
  let roll = rand() * total
  for (const c of CONDITIONS) {
    roll -= c.weight
    if (roll <= 0) return c
  }
  return CONDITIONS[CONDITIONS.length - 1]
}

/** Thrift pricing lands on 49/99 endings, not round hundreds. */
const prettyPrice = (rupees) => {
  const rounded = Math.max(299, Math.round(rupees / 50) * 50)
  return rounded - 1
}

const hasToken = (name, tokens) => {
  const lower = name.toLowerCase()
  return tokens.some((t) => lower.includes(t))
}

/** Most specific pool that fits the garment: by name, then category, then as-is. */
const pickBrand = (archetype) => {
  const keyed = BRANDS_BY_KEYWORD.find((entry) => hasToken(archetype.core, entry.match))
  if (keyed) return pick(keyed.brands)
  const byCategory = BRANDS_BY_CATEGORY[archetype.categoryName]
  return byCategory ? pick(byCategory) : archetype.brand
}

const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** createMany in batches — a single 1500-row insert trips Postgres parameter limits. */
const insertMany = async (model, rows, size = 500) => {
  for (const batch of chunk(rows, size)) {
    await prisma[model].createMany({ data: batch, skipDuplicates: true })
  }
  return rows.length
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

// The curated 52 are identified by name from seedData, so "generated" is simply
// everything else. That avoids adding a marker column to Product purely for the
// benefit of the seeder.
const CURATED_NAMES = PRODUCTS.map((p) => p.name)

const resetGenerated = async () => {
  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@vault-demo.test" } },
    select: { id: true },
  })
  const userIds = demoUsers.map((u) => u.id)

  // Order matters: Order.userId has no cascade, so orders must go before users.
  const orders = await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
  const orderIds = orders.map((o) => o.id)

  const items = await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
  await prisma.return.deleteMany({ where: { orderItemId: { in: items.map((i) => i.id) } } })
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } })
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } })

  await prisma.review.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.cartItem.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.wishlistItem.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })

  // Generated products: images and sizes cascade, reviews cascade.
  //
  // Anything a *surviving* order still points at has to stay, or the delete
  // trips order_items_product_id_fkey. That happens as soon as someone places a
  // real order against a generated listing — browsing the local store and
  // checking out is enough. Those listings are left behind rather than taking
  // the order with them: a stray product is harmless, deleting someone's order
  // is not.
  const stillReferenced = await prisma.orderItem.findMany({
    distinct: ["productId"],
    select: { productId: true },
  })
  const keepIds = stillReferenced.map((i) => i.productId)

  const deleted = await prisma.product.deleteMany({
    where: { name: { notIn: CURATED_NAMES }, id: { notIn: keepIds } },
  })

  const orphaned = await prisma.product.count({ where: { name: { notIn: CURATED_NAMES } } })
  if (orphaned > 0) {
    console.warn(
      `  kept ${orphaned} generated listing(s) still attached to an order placed outside this seeder`
    )
  }
  await prisma.newsletterSubscriber.deleteMany({ where: { email: { endsWith: "@vault-demo.test" } } })

  console.log(`reset: removed ${orderIds.length} orders, ${userIds.length} users, ${deleted.count} products`)
}

// ---------------------------------------------------------------------------
// Archetypes — the 52 curated listings and their real photographs
// ---------------------------------------------------------------------------

const loadArchetypes = async () => {
  const rows = await prisma.product.findMany({
    where: { name: { in: CURATED_NAMES } },
    include: { images: { orderBy: { sortOrder: "asc" } }, sizes: true, category: true },
  })

  const usable = rows.filter((r) => r.images.length > 0 && r.sizes.length > 0)
  if (usable.length === 0) {
    throw new Error("No curated products found. Run `npm run seed` first — this script builds on it.")
  }
  if (usable.length < rows.length) {
    console.warn(`note: ${rows.length - usable.length} curated listing(s) skipped (no photo or no sizes)`)
  }

  return usable.map((r) => ({
    core: r.name,
    photo: r.images[0].url,
    // Extra shots of this same garment type. Each variant takes a different one,
    // so the name-matches-photo guarantee survives while the repetition goes.
    photos: PHOTO_POOL[r.name] ?? [],
    categoryId: r.categoryId,
    categoryName: r.category.name,
    basePrice: r.priceCents / 100,
    brand: r.brand,
    sizes: r.sizes.map((s) => s.size),
    gender: r.gender,
    era: r.era,
    description: r.description,
    highlights: r.highlights,
    details: r.details,
  }))
}

/**
 * Enumerates every listing name the vocabulary can produce, rather than drawing
 * names at random and retrying on collision. Sampling looked fine until it
 * wasn't: archetypes whose core name already contains an era or fit word have a
 * far smaller name space than the rest, and once those filled up a round-robin
 * sampler burned its whole retry budget on them. Enumerating makes the real
 * capacity visible up front and distributes variants across archetypes by how
 * much room each actually has.
 *
 * A name carries one or two prefixes and never alters the core noun phrase —
 * that is what keeps the inherited photograph depicting what the name says.
 * Prefix kinds the core already carries are skipped, so no listing is ever a
 * "90s Y2K Windbreaker" or an "Oversized Cropped Graphic Tee".
 */
const enumerateVariantNames = (archetypes) =>
  archetypes.flatMap((archetype, archetypeIndex) => {
    const eras = hasToken(archetype.core, ERA_TOKENS)
      ? [null]
      : [null, ...ERA_DECADES, ...(archetype.era === "Modern" ? [] : ERA_VAGUE)]
    const fits =
      hasToken(archetype.core, FIT_TOKENS) || !FITTED_CATEGORIES.has(archetype.categoryName)
        ? [null]
        : [null, ...FIT_PREFIXES]

    const material =
      MATERIAL_KEYWORDS.find((entry) => hasToken(archetype.core, entry.match))?.material ?? "textile"
    const flavours = [null, ...FLAVOURS_BY_MATERIAL[material]]
    const names = []

    for (const era of eras) {
      for (const flavour of flavours) {
        for (const fit of fits) {
          const parts = [era, flavour, fit].filter(Boolean)
          // At least one prefix, or the name would collide with the curated row
          // it was derived from. At most two, or it stops reading like a listing.
          if (parts.length === 0 || parts.length > 2) continue
          names.push({
            name: `${parts.join(" ")} ${archetype.core}`,
            archetypeIndex,
            // A decade in the name overrides the archetype's era column, so the
            // two can never disagree.
            era: era && ERA_DECADES.includes(era) ? era : archetype.era,
          })
        }
      }
    }
    return names
  })

const buildProducts = (archetypes, count, taken) => {
  const candidates = shuffle(enumerateVariantNames(archetypes)).filter((c) => !taken.has(c.name))
  if (candidates.length < count) {
    console.warn(
      `note: vocabulary allows ${candidates.length} distinct names, ${count} requested — ` +
        "add prefixes to FLAVOUR_PREFIXES or archetypes to seedData to go higher"
    )
  }

  // How many variants each archetype has produced so far, so successive variants
  // walk through its photo bank rather than all taking the first entry.
  const variantSeq = new Map()

  const products = []
  for (const named of candidates.slice(0, count)) {
    const archetype = archetypes[named.archetypeIndex]
    taken.add(named.name)

    const seq = variantSeq.get(named.archetypeIndex) ?? 0
    variantSeq.set(named.archetypeIndex, seq + 1)

    // Walk the bank in order. Modulo rather than random so reuse only starts
    // once every photo has been used once, and then stays evenly spread.
    const banked = archetype.photos.length > 0 ? archetype.photos[seq % archetype.photos.length] : null
    const photo = banked?.url ?? archetype.photo
    const creditLine =
      banked?.credit?.label ?? (banked?.credit?.name ? `${banked.credit.name} / Unsplash` : null)

    const condition = weightedCondition()
    const price = prettyPrice(archetype.basePrice * condition.multiplier * (0.78 + rand() * 0.5))
    const originalPrice = prettyPrice(price * (2.1 + rand() * 1.3))

    products.push({
      id: randomUUID(),
      name: named.name,
      brand: pickBrand(archetype),
      categoryId: archetype.categoryId,
      priceCents: price * 100,
      originalPriceCents: originalPrice * 100,
      condition: condition.name,
      era: named.era,
      gender: archetype.gender,
      tag: pick(TAGS),
      description: archetype.description,
      highlights: archetype.highlights,
      // Unsplash's terms require crediting the photographer wherever the photo
      // appears. The spec table is already rendered on the product page, so the
      // credit rides along there rather than needing a new column.
      // Openverse pools carry a ready-made label (creator + licence); the
      // Unsplash pool carries just a name. Either way the photographer is
      // credited, which both services' terms require.
      details: creditLine
        ? [...archetype.details, { label: "Photograph", value: creditLine }]
        : archetype.details,
      flaws: condition.flaws,
      // Stock and status are set later, from the order that consumes it.
      stockQuantity: 1,
      status: "live",
      createdAt: between(400, 1),
      // Carried for the image/size rows and never written to Product.
      _photo: photo,
      // Decided here rather than at insert time, because order lines and cart
      // lines pick from this list — choosing again later would let an order
      // reference a size the product does not actually stock. One-of-one pieces
      // usually come in exactly one size.
      _sizes: shuffle(archetype.sizes).slice(0, chance(0.76) ? 1 : 2),
    })
  }

  return products
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const buildUsers = (count, passwordHash) => {
  const users = []
  const seen = new Set()

  for (let i = 0; i < count; i++) {
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    // `.test` is reserved by RFC 2606, so no generated address can ever reach a
    // real inbox. The distinct subdomain is also what --reset keys off.
    let email = `${first}.${last}@vault-demo.test`.toLowerCase()
    if (seen.has(email)) email = `${first}.${last}${i}@vault-demo.test`.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)

    users.push({
      id: randomUUID(),
      email,
      name: `${first} ${last}`,
      passwordHash,
      role: "user",
      phone: `9${int(100000000, 899999999)}`,
      gender: pick(["women", "men", "other", "prefer_not_to_say", null, null]),
      // Reaches further back than the oldest order window (400 days) so the
      // earliest orders still have a plausible pool of accounts to come from.
      createdAt: between(500, 2),
    })
  }
  return users
}

const buildAddresses = (users) => {
  const addresses = []
  for (const user of users) {
    const howMany = chance(0.28) ? 2 : 1
    for (let i = 0; i < howMany; i++) {
      const place = pick(CITIES)
      addresses.push({
        id: randomUUID(),
        userId: user.id,
        recipientName: user.name,
        phone: user.phone,
        line1: `${int(1, 320)}, ${pick(STREETS)}`,
        city: place.city,
        state: place.state,
        postalCode: `${place.pin}${int(10, 99)}`,
        country: "India",
        isDefault: i === 0,
        _hub: place.hub,
        _city: place.city,
      })
    }
  }
  return addresses
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * When an order of a given status could plausibly have been placed, in days ago.
 *
 * The lower bound is not cosmetic: it has to leave room for the whole lifecycle
 * that follows. A delivered order stamps dispatch (+1-3d), a hub scan, out-for-
 * delivery (+2-5d) and delivery, so placing one 7 days ago would date its own
 * tracking events in the future. Each bound below clears its status's longest
 * tail with a little margin.
 */
const CREATED_WINDOW = {
  fulfilled: [400, 25],
  delivered: [120, 9.5],
  // In transit right now, so it has to be recent — but still older than its
  // dispatch and transit scans.
  shipped: [21, 6],
  // Paid but not yet dispatched — more recent still.
  paid: [7, 0.2],
  // Cancellation can trail the order by up to ~4 days.
  cancelled: [400, 5],
  // Inside the 15-minute hold — between ~14 minutes and ~1 minute ago. This has
  // to be a live hold, not a lapsed one: releaseExpiredOrders sweeps anything
  // past its expiry, so dating these further back just hands the running API a
  // batch of orders to cancel the moment it boots. Abandoned checkouts from
  // earlier are already represented as `cancelled`.
  pending_payment: [0.0097, 0.0007],
}

const ITEM_COUNT_ROLL = () => (chance(0.72) ? 1 : chance(0.72) ? 2 : chance(0.75) ? 3 : 4)

/**
 * Assembles orders, their lines, payment and tracking history, and decides what
 * each consumed product's final stock and status must be.
 *
 * Mirrors order.service.js: createOrder holds stock and writes a `created`
 * payment; the webhook captures it and logs "Payment confirmed"; setOrderStatus
 * stamps shippedAt/deliveredAt and writes one event per milestone; cancelling
 * puts stock back and refunds a capture if there was one.
 */
const buildOrders = ({ users, addressesByUser, soldPool, mix }) => {
  const orders = []
  const items = []
  const payments = []
  const events = []
  const productUpdates = new Map() // productId -> { stockQuantity, status }

  let poolCursor = 0
  const takeProduct = () => (poolCursor < soldPool.length ? soldPool[poolCursor++] : null)

  // Repeat customers: a minority of accounts place most of the orders, which is
  // what makes "top customers" in the admin view worth looking at.
  const loyalIds = new Set(
    shuffle(users).slice(0, Math.max(1, Math.round(users.length * 0.22))).map((u) => u.id)
  )

  // Buyers are chosen *after* the order date, from the accounts that already
  // existed then. Nudging the date forward instead (the obvious shortcut) pushes
  // a delivered order's tracking events past now, because the lifecycle tail is
  // longer than the nudge.
  const byAge = [...users].sort((a, b) => a.createdAt - b.createdAt)
  const eligibleCount = (at) => {
    let lo = 0
    let hi = byAge.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (byAge[mid].createdAt < at) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const buyerFor = (at) => {
    const cut = eligibleCount(at)
    if (cut === 0) return null
    const pool = byAge.slice(0, cut)
    if (chance(0.45)) {
      const loyalPool = pool.filter((u) => loyalIds.has(u.id))
      if (loyalPool.length > 0) return pick(loyalPool)
    }
    return pick(pool)
  }

  const statuses = shuffle(
    Object.entries(mix).flatMap(([status, n]) => Array.from({ length: n }, () => status))
  )

  for (const status of statuses) {
    const [from, to] = CREATED_WINDOW[status]
    const createdAt = between(from, to)

    const user = buyerFor(createdAt)
    if (!user) continue // no account existed this far back
    const userAddresses = addressesByUser.get(user.id) ?? []
    if (userAddresses.length === 0) continue
    const address = pick(userAddresses)

    const wanted = ITEM_COUNT_ROLL()
    const lines = []
    for (let i = 0; i < wanted; i++) {
      const product = takeProduct()
      if (!product) break
      lines.push(product)
    }
    if (lines.length === 0) break // pool exhausted; stop rather than write empty orders

    const orderId = randomUUID()
    let subtotalCents = 0

    for (const product of lines) {
      subtotalCents += product.priceCents
      items.push({
        id: randomUUID(),
        orderId,
        productId: product.id,
        size: pick(product._sizes),
        qty: 1, // one-of-one stock: a line can never be more than one
        priceCents: product.priceCents,
      })

      // Cancelling returns the piece to the shelf; every other status keeps it held or sold.
      productUpdates.set(
        product.id,
        status === "cancelled"
          ? { stockQuantity: 1, status: "live" }
          : { stockQuantity: 0, status: "sold" }
      )
    }

    const order = {
      id: orderId,
      userId: user.id,
      addressId: address.id,
      subtotalCents,
      totalCents: subtotalCents,
      status,
      idempotencyKey: `bulk_${orderId}`,
      expiresAt: null,
      expectedDeliveryAt: null,
      shippedAt: null,
      deliveredAt: null,
      createdAt,
    }

    const gatewayRef = `mock_pay_${randomUUID()}`
    const payment = {
      id: randomUUID(),
      orderId,
      gateway: "mock",
      gatewayRef,
      status: "created",
      amountCents: subtotalCents,
      createdAt: plusMinutes(createdAt, 1),
    }

    const log = (label, at, location = null) =>
      events.push({ id: randomUUID(), orderId, label, location, createdAt: at })

    if (status === "pending_payment") {
      // 15-minute hold, exactly as ORDER_HOLD_MINUTES defaults.
      order.expiresAt = plusMinutes(createdAt, 15)
    } else if (status === "cancelled") {
      // Two ways an order ends up here: the shopper cancelled a paid order, or
      // the sweep released an abandoned checkout. Only the first has a refund.
      const wasPaid = chance(0.42)
      const cancelledAt = plusMinutes(createdAt, wasPaid ? int(90, 6000) : int(16, 1440))
      if (wasPaid) {
        payment.status = "refunded"
        log("Payment confirmed", plusMinutes(createdAt, int(1, 8)))
      }
      log("Order cancelled", cancelledAt)
    } else {
      // paid / shipped / delivered / fulfilled all cleared payment first.
      payment.status = "captured"
      const paidAt = plusMinutes(createdAt, int(1, 11))
      log("Payment confirmed", paidAt)

      if (status !== "paid") {
        const shippedAt = plusDays(createdAt, 1 + rand() * 2)
        order.shippedAt = shippedAt
        order.expectedDeliveryAt = plusDays(shippedAt, 5) // DELIVERY_DAYS
        log("Dispatched from our studio", shippedAt, "Mumbai")
        log("Reached sorting hub", plusDays(shippedAt, 0.6 + rand()), address._hub)

        if (status === "delivered" || status === "fulfilled") {
          const outForDelivery = plusDays(shippedAt, 2 + rand() * 3)
          const deliveredAt = plusMinutes(outForDelivery, int(120, 540))
          order.deliveredAt = deliveredAt
          log("Out for delivery", outForDelivery, address._city)
          log("Delivered", deliveredAt, address._city)
        } else {
          log("In transit", plusDays(shippedAt, 1.4 + rand()), address._hub)
        }
      }
    }

    payments.push(payment)
    orders.push(order)
  }

  return { orders, items, payments, events, productUpdates, consumed: poolCursor }
}

// ---------------------------------------------------------------------------
// Returns, reviews, carts
// ---------------------------------------------------------------------------

const buildReturns = (orders, itemsByOrder) => {
  const returns = []
  const settled = orders.filter((o) => o.status === "delivered" || o.status === "fulfilled")

  for (const order of settled) {
    if (!chance(0.07)) continue
    const lines = itemsByOrder.get(order.id) ?? []
    if (lines.length === 0) continue
    const line = pick(lines)

    // A return has to be filed within the 14-day window and cannot be filed in
    // the future, so a piece delivered yesterday simply has no return yet.
    const requestedAt = afterWithin(order.deliveredAt ?? order.createdAt, 1, 11)
    if (!requestedAt) continue

    // Support can only have resolved it if there has been time to. Otherwise it
    // is still open, which is the honest state for a fresh request.
    const resolvedAt = afterWithin(requestedAt, 1, 6)
    const status = resolvedAt
      ? pick(["requested", "approved", "approved", "completed", "completed", "rejected"])
      : "requested"
    const reason = pick(RETURN_REASONS)

    returns.push({
      id: randomUUID(),
      orderItemId: line.id,
      userId: order.userId,
      type: chance(0.68) ? "refund" : "exchange",
      reason,
      note: RETURN_NOTES[reason],
      status,
      createdAt: requestedAt,
      // A request still in play has no resolution date yet.
      resolvedAt: status === "requested" ? null : resolvedAt,
    })
  }
  return returns
}

const buildReviews = (orders, itemsByOrder) => {
  const reviews = []
  // Review has a unique [productId, userId]; one-of-one stock means a product has
  // a single buyer, but the guard keeps a repeat-purchase edge case from failing.
  const seen = new Set()
  const settled = orders.filter((o) => o.status === "delivered" || o.status === "fulfilled")

  for (const order of settled) {
    for (const line of itemsByOrder.get(order.id) ?? []) {
      if (!chance(0.34)) continue
      const key = `${line.productId}:${order.userId}`
      if (seen.has(key)) continue

      // Nobody reviews a parcel before it has been worn, and nobody reviews it
      // in the future — a very recent delivery just has no review yet.
      const writtenAt = afterWithin(order.deliveredAt ?? order.createdAt, 2, 22)
      if (!writtenAt) continue
      seen.add(key)

      // Skewed high, with a real tail — the same shape buildRatings aims for.
      const rating = chance(0.52) ? 5 : chance(0.58) ? 4 : chance(0.62) ? 3 : chance(0.6) ? 2 : 1
      reviews.push({
        id: randomUUID(),
        productId: line.productId,
        userId: order.userId,
        rating,
        comment: pick(REVIEW_CONTENT[rating]),
        createdAt: writtenAt,
      })
    }
  }
  return reviews
}

const buildBaskets = (users, liveProducts) => {
  const cartItems = []
  const wishlistItems = []
  if (liveProducts.length === 0) return { cartItems, wishlistItems }

  const cartSeen = new Set()
  const wishSeen = new Set()

  for (const user of users) {
    if (chance(0.19)) {
      for (let i = 0; i < int(1, 3); i++) {
        const product = pick(liveProducts)
        const size = pick(product._sizes)
        const key = `${user.id}:${product.id}:${size}`
        if (cartSeen.has(key)) continue
        cartSeen.add(key)
        cartItems.push({
          id: randomUUID(),
          userId: user.id,
          productId: product.id,
          size,
          qty: 1,
          addedAt: between(30, 0.1),
        })
      }
    }
    if (chance(0.38)) {
      for (let i = 0; i < int(1, 6); i++) {
        const product = pick(liveProducts)
        const key = `${user.id}:${product.id}`
        if (wishSeen.has(key)) continue
        wishSeen.add(key)
        wishlistItems.push({
          id: randomUUID(),
          userId: user.id,
          productId: product.id,
          addedAt: between(200, 0.1),
        })
      }
    }
  }
  return { cartItems, wishlistItems }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const started = Date.now()

  if (RESET) {
    await resetGenerated()
  } else {
    const existing = await prisma.user.count({ where: { email: { endsWith: "@vault-demo.test" } } })
    if (existing > 0) {
      console.error(
        `Refusing to run: ${existing} generated accounts already exist.\n` +
          "Re-run with --reset to replace the previous generation."
      )
      process.exit(1)
    }
  }

  const archetypes = await loadArchetypes()
  console.log(`archetypes: ${archetypes.length} curated listings with real photographs`)

  const mix = Object.fromEntries(Object.entries(ORDER_MIX).map(([k, v]) => [k, scaled(v)]))
  const orderTotal = Object.values(mix).reduce((a, b) => a + b, 0)

  // Size the catalogue from the order book: average 1.38 lines per order, plus a
  // margin so the pool never runs dry mid-build, plus browsable live stock.
  const soldNeeded = Math.ceil(orderTotal * 1.45)
  const liveNeeded = scaled(EXTRA_LIVE_PRODUCTS)

  const takenNames = new Set(CURATED_NAMES)
  const generated = buildProducts(archetypes, soldNeeded + liveNeeded, takenNames)
  const soldPool = generated.slice(0, soldNeeded)
  const livePool = generated.slice(soldNeeded)

  // --- products, photos, sizes -------------------------------------------------
  await insertMany(
    "product",
    generated.map(({ _photo, _sizes, ...row }) => row)
  )
  await insertMany(
    "productImage",
    // One photo per listing. The Blob bucket holds a single front-facing shot per
    // archetype, so inventing "-back"/"-detail" URLs would 404 on the real site.
    generated.map((p) => ({ id: randomUUID(), productId: p.id, url: p._photo, sortOrder: 0 }))
  )
  await insertMany(
    "productSize",
    generated.flatMap((p) => p._sizes.map((size) => ({ id: randomUUID(), productId: p.id, size })))
  )
  console.log(`products: ${generated.length} (${soldPool.length} for the order book, ${livePool.length} live)`)

  // Photo variety is the thing most likely to quietly regress, so state it.
  const distinctPhotos = new Set(generated.map((p) => p._photo)).size
  const worst = Math.max(
    ...Object.values(
      generated.reduce((acc, p) => ((acc[p._photo] = (acc[p._photo] ?? 0) + 1), acc), {})
    )
  )
  const banked = Object.values(PHOTO_POOL).reduce((n, v) => n + v.length, 0)
  console.log(
    `photos: ${distinctPhotos} distinct across ${generated.length} listings ` +
      `(most-reused appears ${worst}x)` +
      (banked === 0
        ? "\n  note: no photoPool.json — run `node prisma/fetchPhotos.js` with an" +
          " UNSPLASH_ACCESS_KEY to give each listing its own photograph"
        : ` — ${banked} banked from Unsplash`)
  )

  // --- people ------------------------------------------------------------------
  // One bcrypt hash shared across accounts: cost 12 is deliberately slow, and
  // hashing 320 times would dominate the runtime for no benefit.
  const passwordHash = await bcrypt.hash("Password123!", 12)
  const users = buildUsers(scaled(SHOPPERS), passwordHash)
  const addresses = buildAddresses(users)

  await insertMany("user", users)
  await insertMany(
    "address",
    addresses.map(({ _hub, _city, ...row }) => row)
  )

  const addressesByUser = new Map()
  for (const a of addresses) {
    if (!addressesByUser.has(a.userId)) addressesByUser.set(a.userId, [])
    addressesByUser.get(a.userId).push(a)
  }
  console.log(`accounts: ${users.length} shoppers, ${addresses.length} addresses`)

  // --- orders ------------------------------------------------------------------
  const { orders, items, payments, events, productUpdates, consumed } = buildOrders({
    users,
    addressesByUser,
    soldPool,
    mix,
  })

  await insertMany("order", orders)
  await insertMany("orderItem", items)
  await insertMany("payment", payments)
  await insertMany("orderEvent", events, 1000)

  // Stock and status, applied in two bulk statements rather than one update per
  // product — 1450 round trips would be the slowest part of the whole script.
  const soldIds = []
  const liveIds = []
  for (const [id, state] of productUpdates) (state.status === "sold" ? soldIds : liveIds).push(id)

  for (const batch of chunk(soldIds, 1000)) {
    await prisma.product.updateMany({ where: { id: { in: batch } }, data: { stockQuantity: 0, status: "sold", version: 1 } })
  }
  for (const batch of chunk(liveIds, 1000)) {
    await prisma.product.updateMany({ where: { id: { in: batch } }, data: { stockQuantity: 1, status: "live", version: 2 } })
  }

  // Products in the sold pool that no order reached stay on the shelf.
  const unconsumed = soldPool.slice(consumed).map((p) => p.id)
  for (const batch of chunk(unconsumed, 1000)) {
    await prisma.product.updateMany({ where: { id: { in: batch } }, data: { stockQuantity: 1, status: "live" } })
  }

  console.log(`orders: ${orders.length}, lines: ${items.length}, payments: ${payments.length}, tracking events: ${events.length}`)

  // --- returns, reviews, baskets ----------------------------------------------
  const itemsByOrder = new Map()
  for (const i of items) {
    if (!itemsByOrder.has(i.orderId)) itemsByOrder.set(i.orderId, [])
    itemsByOrder.get(i.orderId).push(i)
  }

  const returns = buildReturns(orders, itemsByOrder)
  const reviews = buildReviews(orders, itemsByOrder)
  const browsable = [...livePool, ...soldPool.slice(consumed)]
  const { cartItems, wishlistItems } = buildBaskets(users, browsable)

  await insertMany("return", returns)
  await insertMany("review", reviews)
  await insertMany("cartItem", cartItems)
  await insertMany("wishlistItem", wishlistItems)
  await insertMany(
    "newsletterSubscriber",
    Array.from({ length: scaled(NEWSLETTER_SUBSCRIBERS) }, (_, i) => ({
      id: randomUUID(),
      email: `${pick(FIRST_NAMES)}.${pick(LAST_NAMES)}${i}@vault-demo.test`.toLowerCase(),
      subscribedAt: between(400, 0.5),
    }))
  )

  console.log(`returns: ${returns.length}, reviews: ${reviews.length}, carts: ${cartItems.length}, wishlists: ${wishlistItems.length}`)

  // --- summary -----------------------------------------------------------------
  const byStatus = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } })
  const revenue = await prisma.order.aggregate({
    _sum: { totalCents: true },
    where: { status: { in: ["paid", "shipped", "delivered", "fulfilled"] } },
  })

  console.log("\n--- database totals ---")
  console.table({
    products: await prisma.product.count(),
    productImages: await prisma.productImage.count(),
    users: await prisma.user.count(),
    addresses: await prisma.address.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    payments: await prisma.payment.count(),
    orderEvents: await prisma.orderEvent.count(),
    returns: await prisma.return.count(),
    reviews: await prisma.review.count(),
    cartItems: await prisma.cartItem.count(),
    wishlistItems: await prisma.wishlistItem.count(),
    newsletter: await prisma.newsletterSubscriber.count(),
  })
  console.log("orders by status:", Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])))
  console.log(`recognised revenue: ₹${((revenue._sum.totalCents ?? 0) / 100).toLocaleString("en-IN")}`)
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log("\nGenerated accounts log in with: Password123!")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
