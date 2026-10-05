/**
 * Builds prisma/photoPool.json from Openverse — openly-licensed photographs,
 * no API key and no signup required.
 *
 *   node prisma/fetchPhotosOpenverse.js
 *
 * Writes the same pool format as fetchPhotos.js (the Unsplash version), so
 * seedBulk.js consumes either without caring which produced it. Run whichever
 * suits: Unsplash gives better photography but needs a key, Openverse needs
 * nothing but indexes a smaller and more amateur library.
 *
 * LICENSING: restricted to cc0, pdm and by. NonCommercial is excluded because
 * this is a storefront, and ShareAlike is excluded because its reciprocity
 * terms are a poor fit for a product catalogue. Every photo therefore permits
 * commercial use and modification, and every one is credited — CC BY requires
 * attribution, so the creator and licence ride along in the pool and render in
 * the product spec table.
 *
 * RATE LIMITS (anonymous): 20 requests/minute burst, 200/day sustained. A full
 * pass over 51 archetypes costs ~100 requests, which fits inside a day but not
 * inside a minute, so requests are spaced out. Expect it to take ~6 minutes.
 * Progress is written after every archetype, so stopping it loses nothing.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { OPENVERSE_QUERIES, REQUIRED_WORDS, EXCLUDE_WORDS } from "./openverseQueries.js"
import { PRODUCTS } from "./seedData.js"

const POOL_PATH = join(dirname(fileURLToPath(import.meta.url)), "photoPool.json")

const TARGET = Number(process.env.TARGET ?? 40)
const PER_PAGE = 20 // Openverse anonymous maximum
// 20/min burst; 3.4s keeps us just under it without tripping a 429.
const THROTTLE_MS = Number(process.env.THROTTLE_MS ?? 3400)
const LICENSES = "cc0,pdm,by"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A keyword match is not a relevance match. Searching "windbreaker" returns a
 * tank turret and a line of trees; "girl in a windbreaker" turns out to be a
 * cartoon. So a result is kept only if the garment is named in its own title
 * or tags — the metadata the uploader wrote, not the query we guessed.
 */
const isRelevant = (result, required) => {
  const haystack = [result.title ?? "", ...(result.tags ?? []).map((t) => t.name ?? "")]
    .join(" ")
    .toLowerCase()
  if (EXCLUDE_WORDS.some((word) => haystack.includes(word))) return false
  if (!required || required.length === 0) return true
  return required.some((word) => haystack.includes(word))
}
const loadPool = () => (existsSync(POOL_PATH) ? JSON.parse(readFileSync(POOL_PATH, "utf8")) : {})
const savePool = (pool) => writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2) + "\n")

/** CC BY needs the creator named and the licence stated wherever the photo runs. */
const creditFor = (r) => ({
  label: `${r.creator || "Unknown"} / ${String(r.license || "cc").toUpperCase()} via Openverse`,
  link: r.foreign_landing_url || r.url || null,
})

const main = async () => {
  const archetypeNames = PRODUCTS.map((p) => p.name)
  const missing = archetypeNames.filter((n) => !OPENVERSE_QUERIES[n])
  if (missing.length) console.warn("No search terms for:", missing.join(", "))

  const pool = loadPool()
  let requests = 0
  let added = 0
  let stop = false

  for (const archetype of archetypeNames) {
    const queries = OPENVERSE_QUERIES[archetype]
    if (!queries) continue

    const collected = [...(pool[archetype] ?? [])]
    if (collected.length >= TARGET) continue
    const seen = new Set(collected.map((p) => p.id))
    let usedQuery = null

    // Walk the fallback chain: keep the most specific wording that delivers.
    for (const query of queries) {
      if (collected.length >= TARGET || stop) break

      for (let page = 1; collected.length < TARGET && page <= 3; page++) {
        const url =
          `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
          `&license=${LICENSES}&page_size=${PER_PAGE}&page=${page}&category=photograph`

        let res
        try {
          res = await fetch(url, { headers: { "User-Agent": "ThriftVaultSeed/1.0" } })
        } catch (err) {
          console.warn(`  ${archetype}: network error (${err.message.slice(0, 40)}), skipping`)
          break
        }
        requests++

        if (res.status === 429) {
          console.warn(`\nRate limited after ${requests} requests. Progress saved.`)
          stop = true
          break
        }
        if (!res.ok) break

        const body = await res.json()
        const results = body.results ?? []
        if (results.length === 0) break

        for (const r of results) {
          if (collected.length >= TARGET) break
          // `url` is the direct image; entries without one cannot be rendered.
          if (!r.url || seen.has(r.id)) continue
          if (!isRelevant(r, REQUIRED_WORDS[archetype])) continue
          seen.add(r.id)
          // Title is kept so the pool can be audited later without re-fetching.
          collected.push({ id: r.id, url: r.url, title: r.title ?? null, credit: creditFor(r) })
          added++
          usedQuery = usedQuery ?? query
        }

        const left = res.headers.get("x-ratelimit-available-anon_sustained")
        if (left !== null && Number(left) < 5) {
          console.warn(`\nDaily budget nearly spent (${left} left). Progress saved.`)
          stop = true
          break
        }

        await sleep(THROTTLE_MS)
      }
    }

    pool[archetype] = collected
    savePool(pool)
    console.log(
      `  ${archetype.padEnd(32)} ${String(collected.length).padStart(3)} photos` +
        (usedQuery ? `  (“${usedQuery}”)` : "")
    )
    if (stop) break
  }

  const total = Object.values(pool).reduce((n, v) => n + v.length, 0)
  const filled = Object.values(pool).filter((v) => v.length > 0).length
  const short = archetypeNames.filter((n) => (pool[n]?.length ?? 0) < TARGET)

  console.log(`\nphotoPool.json: ${total} photos across ${filled}/${archetypeNames.length} archetypes`)
  console.log(`requests used: ${requests}, photos added: ${added}`)
  if (short.length > 0) {
    console.log(`\n${short.length} archetype(s) below ${TARGET} — re-run to top up:`)
    short.slice(0, 8).forEach((n) => console.log(`  ${n} (${pool[n]?.length ?? 0})`))
  } else {
    console.log("\nAll archetypes filled. Now run: npm run seed:bulk:reset")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
