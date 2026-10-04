/**
 * Builds prisma/photoPool.json — a bank of real Unsplash photographs per
 * garment archetype, so every generated listing can have its own picture
 * instead of sharing one of the 51 curated shots.
 *
 * Why this exists: there is no longer a keyless keyword image service.
 * source.unsplash.com is retired (503), loremflickr returns 401, and picsum
 * only serves random images, which would put a landscape on a jacket listing.
 * The official Unsplash API is the one route that returns a photo of the thing
 * you asked for, and it needs a key.
 *
 *   1. Create a free app at https://unsplash.com/oauth/applications (no card).
 *   2. Copy the "Access Key".
 *   3. UNSPLASH_ACCESS_KEY=... node prisma/fetchPhotos.js
 *
 * RATE LIMIT: a new Unsplash app is in "Demo" mode, capped at 50 requests per
 * hour. Covering all 51 archetypes takes ~102 requests at 2 pages each, so this
 * script is resumable: it writes after every query, skips archetypes it has
 * already filled, and stops cleanly when the budget runs out. Re-run it in an
 * hour and it picks up where it left off. Applying for Production access on the
 * same page lifts the cap to 5000/hour and lets it finish in one go.
 *
 * ATTRIBUTION: Unsplash's API terms require crediting the photographer. The
 * pool stores each photo's author name and profile link so the app can display
 * it — see the `credit` field on every entry.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PHOTO_QUERIES } from "./photoQueries.js"
import { PRODUCTS } from "./seedData.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const POOL_PATH = join(HERE, "photoPool.json")

const KEY = process.env.UNSPLASH_ACCESS_KEY
// How many photos to bank per archetype. 1670 products over 51 archetypes is
// ~33 each, so 40 leaves headroom for duplicates Unsplash returns across pages.
const TARGET = Number(process.env.TARGET ?? 40)
const PER_PAGE = 30 // Unsplash maximum

if (!KEY) {
  console.error(
    "Missing UNSPLASH_ACCESS_KEY.\n\n" +
      "  1. Sign in at https://unsplash.com/oauth/applications\n" +
      '  2. "New Application", accept the terms, name it anything\n' +
      '  3. Copy the "Access Key" (not the Secret key)\n' +
      "  4. UNSPLASH_ACCESS_KEY=xxx node prisma/fetchPhotos.js\n"
  )
  process.exit(1)
}

// Match the sizing already used by the curated listings, so new photos render
// identically to the hand-picked ones.
const sized = (rawUrl) => `${rawUrl}&w=900&h=1125&fit=crop&q=80`

const loadPool = () => (existsSync(POOL_PATH) ? JSON.parse(readFileSync(POOL_PATH, "utf8")) : {})
const savePool = (pool) => writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2) + "\n")

const main = async () => {
  // A query map that has drifted from seedData would silently leave archetypes
  // with no photos, so say so rather than discovering it at seed time.
  const archetypeNames = PRODUCTS.map((p) => p.name)
  const missingQuery = archetypeNames.filter((n) => !PHOTO_QUERIES[n])
  const staleQuery = Object.keys(PHOTO_QUERIES).filter((n) => !archetypeNames.includes(n))
  if (missingQuery.length) console.warn("No search term for:", missingQuery.join(", "))
  if (staleQuery.length) console.warn("Search term for unknown archetype:", staleQuery.join(", "))

  const pool = loadPool()
  let requests = 0
  let added = 0
  let stoppedEarly = false

  for (const [archetype, query] of Object.entries(PHOTO_QUERIES)) {
    if (!archetypeNames.includes(archetype)) continue

    const have = pool[archetype] ?? []
    if (have.length >= TARGET) continue

    const seen = new Set(have.map((p) => p.id))
    const collected = [...have]

    for (let page = 1; collected.length < TARGET && page <= Math.ceil(TARGET / PER_PAGE) + 1; page++) {
      const url =
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
        `&per_page=${PER_PAGE}&page=${page}&orientation=portrait&content_filter=high`

      const res = await fetch(url, {
        headers: { Authorization: `Client-ID ${KEY}`, "Accept-Version": "v1" },
      })
      requests++

      if (res.status === 401) {
        console.error("\nUnsplash rejected the key (401). Check UNSPLASH_ACCESS_KEY is the Access Key.")
        savePool(pool)
        process.exit(1)
      }
      if (res.status === 403) {
        // Hourly budget exhausted — not an error, just time to stop.
        console.warn(`\nRate limit reached after ${requests} requests. Progress saved.`)
        stoppedEarly = true
        break
      }
      if (!res.ok) {
        console.warn(`  ${archetype}: HTTP ${res.status}, skipping`)
        break
      }

      const body = await res.json()
      const results = body.results ?? []
      if (results.length === 0) break

      for (const photo of results) {
        if (seen.has(photo.id) || collected.length >= TARGET) continue
        seen.add(photo.id)
        collected.push({
          id: photo.id,
          url: sized(photo.urls.raw),
          // Unsplash's terms require crediting the photographer wherever the
          // photo is shown.
          credit: { name: photo.user?.name ?? null, link: photo.user?.links?.html ?? null },
        })
        added++
      }

      const remaining = res.headers.get("x-ratelimit-remaining")
      if (remaining !== null && Number(remaining) <= 0) {
        console.warn(`\nRate limit budget spent. Progress saved.`)
        stoppedEarly = true
        break
      }
    }

    pool[archetype] = collected
    savePool(pool) // write as we go, so an interrupted run loses nothing
    console.log(`  ${archetype.padEnd(34)} ${String(collected.length).padStart(3)} photos`)

    if (stoppedEarly) break
  }

  const filled = Object.entries(pool).filter(([, v]) => v.length > 0)
  const total = filled.reduce((n, [, v]) => n + v.length, 0)
  const short = archetypeNames.filter((n) => (pool[n]?.length ?? 0) < TARGET)

  console.log(`\nphotoPool.json: ${total} photos across ${filled.length}/${archetypeNames.length} archetypes`)
  console.log(`requests used this run: ${requests}, photos added: ${added}`)

  if (short.length > 0) {
    console.log(`\n${short.length} archetype(s) still below ${TARGET}:`)
    short.slice(0, 10).forEach((n) => console.log(`  ${n} (${pool[n]?.length ?? 0})`))
    if (short.length > 10) console.log(`  ...and ${short.length - 10} more`)
    console.log("\nRe-run in an hour to continue — already-filled archetypes are skipped.")
  } else {
    console.log("\nAll archetypes filled. Now run: npm run seed:bulk:reset")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
