// Turns a shopper's free-text query into structured search intent.
//
// The problem this solves: the catalogue stores a garment called "Baggy Carpenter
// Denim" in a category called "Denim", but nobody searches for that. They search
// "jeans". A literal `contains` match returns nothing and the store looks empty.
//
// Everything below runs locally on one short string, so it costs nothing and adds
// no latency. It is deliberately a dictionary rather than a model: the vocabulary of
// a clothing catalogue is small and closed, and a lookup table is easy to read,
// easy to extend, and never returns a surprise.

// Word -> category name. Keys are matched against whole words only, so "top" does
// not fire inside "high-tops".
const CATEGORY_WORDS = {
  // Denim
  jeans: "Denim", jean: "Denim", denim: "Denim", dungarees: "Denim", jeggings: "Denim",
  // Jackets
  jacket: "Jackets", jackets: "Jackets", coat: "Jackets", coats: "Jackets",
  blazer: "Jackets", bomber: "Jackets", puffer: "Jackets", windbreaker: "Jackets",
  parka: "Jackets", outerwear: "Jackets", trench: "Jackets", biker: "Jackets",
  // Tops
  top: "Tops", tops: "Tops", tee: "Tops", tees: "Tops", tshirt: "Tops",
  "t-shirt": "Tops", shirt: "Tops", shirts: "Tops", hoodie: "Tops", hoodies: "Tops",
  sweatshirt: "Tops", crewneck: "Tops", blouse: "Tops", flannel: "Tops", satin: "Tops",
  // Dresses
  dress: "Dresses", dresses: "Dresses", gown: "Dresses", gowns: "Dresses",
  frock: "Dresses", sundress: "Dresses", maxi: "Dresses", midi: "Dresses",
  // Bottoms
  pants: "Bottoms", trousers: "Bottoms", trouser: "Bottoms", cargos: "Bottoms",
  cargo: "Bottoms", shorts: "Bottoms", skirt: "Bottoms", skirts: "Bottoms",
  bottoms: "Bottoms", joggers: "Bottoms", leggings: "Bottoms", chinos: "Bottoms",
  // Footwear
  shoes: "Footwear", shoe: "Footwear", sneakers: "Footwear", sneaker: "Footwear",
  trainers: "Footwear", kicks: "Footwear", boots: "Footwear", boot: "Footwear",
  footwear: "Footwear", heels: "Footwear", loafers: "Footwear", sandals: "Footwear",
  // Knitwear
  sweater: "Knitwear", sweaters: "Knitwear", jumper: "Knitwear", knit: "Knitwear",
  knitwear: "Knitwear", cardigan: "Knitwear", pullover: "Knitwear", wool: "Knitwear",
  woolen: "Knitwear", woollen: "Knitwear",
  // Accessories
  bag: "Accessories", bags: "Accessories", handbag: "Accessories", tote: "Accessories",
  purse: "Accessories", crossbody: "Accessories", scarf: "Accessories",
  hat: "Accessories", cap: "Accessories", sunglasses: "Accessories",
  shades: "Accessories", belt: "Accessories", necklace: "Accessories",
  jewellery: "Accessories", jewelry: "Accessories", accessories: "Accessories",
  accessory: "Accessories",
}

// Occasion and weather words map to more than one category, because "something warm"
// legitimately means a coat or a jumper.
const VIBE_WORDS = {
  warm: ["Knitwear", "Jackets"], cosy: ["Knitwear"], cozy: ["Knitwear"],
  winter: ["Knitwear", "Jackets"], cold: ["Knitwear", "Jackets"],
  summer: ["Dresses", "Tops"], beach: ["Dresses"], holiday: ["Dresses"],
  party: ["Dresses"], wedding: ["Dresses"], formal: ["Bottoms", "Tops"],
  office: ["Bottoms", "Tops"], work: ["Bottoms", "Tops"],
}

const GENDER_WORDS = {
  women: "women", woman: "women", womens: "women", "women's": "women",
  ladies: "women", lady: "women", female: "women", girl: "women", girls: "women",
  her: "women", she: "women",
  men: "men", man: "men", mens: "men", "men's": "men", male: "men",
  boy: "men", boys: "men", guy: "men", guys: "men", him: "men", he: "men",
  unisex: "unisex",
}

const CHEAP_WORDS = new Set(["cheap", "cheapest", "affordable", "budget", "bargain", "low", "inexpensive"])
const PRICEY_WORDS = new Set(["expensive", "premium", "luxury", "priciest", "designer", "splurge"])

// Words that carry no search signal. Dropping them stops "a dress for the summer"
// from trying to text-match "a", "for" and "the" against product descriptions.
const STOP_WORDS = new Set([
  "a", "an", "the", "for", "of", "in", "on", "to", "with", "and", "or", "my",
  "me", "i", "some", "something", "any", "is", "are", "that", "this", "at",
  "under", "below", "over", "above", "than", "less", "more", "want", "need",
  "looking", "show", "find", "get", "buy", "rs", "inr", "rupees",
])

/**
 * Parses a raw search string into intent.
 * @returns {{categories: string[], gender: string|null, sort: string|null,
 *            maxPrice: number|null, terms: string[], matched: boolean}}
 */
export const parseSearchIntent = (raw) => {
  const text = String(raw ?? "").toLowerCase().trim()
  if (!text) {
    return { categories: [], gender: null, sort: null, maxPrice: null, terms: [], matched: false }
  }

  // "under 2000" / "below 1,500" / "<3000". Captured before tokenising so the
  // number itself never leaks into the text terms.
  let maxPrice = null
  const priceMatch = text.match(/(?:under|below|less than|upto|up to|<)\s*(?:rs\.?|inr|₹)?\s*([\d,]+)/)
  if (priceMatch) {
    const n = Number(priceMatch[1].replace(/,/g, ""))
    if (Number.isFinite(n) && n > 0) maxPrice = n
  }

  const tokens = text.split(/[^a-z0-9'-]+/).filter(Boolean)

  const categories = new Set()
  let gender = null
  let sort = null
  const terms = []

  for (const token of tokens) {
    if (CATEGORY_WORDS[token]) {
      categories.add(CATEGORY_WORDS[token])
      continue
    }
    if (VIBE_WORDS[token]) {
      VIBE_WORDS[token].forEach((c) => categories.add(c))
      continue
    }
    if (GENDER_WORDS[token]) {
      gender = gender ?? GENDER_WORDS[token]
      continue
    }
    if (CHEAP_WORDS.has(token)) {
      sort = sort ?? "price_asc"
      continue
    }
    if (PRICEY_WORDS.has(token)) {
      sort = sort ?? "price_desc"
      continue
    }
    // Pure numbers are almost always part of a price phrase already handled above.
    if (/^\d+$/.test(token)) continue
    if (STOP_WORDS.has(token)) continue
    terms.push(token)
  }

  return {
    categories: [...categories],
    gender,
    sort,
    maxPrice,
    terms,
    // Did the dictionary understand anything at all? Drives the fallback in
    // catalog.service: an unrecognised query should still try a plain text match.
    matched: categories.size > 0 || gender !== null || sort !== null || maxPrice !== null,
  }
}

/**
 * Builds a sort-rank function for this shopper: lower sorts first.
 *
 * Three tiers, not two. Lumping `unisex` in with the exact match would put roughly
 * two thirds of this catalogue on the same rank and the ordering would do nothing
 * visible. Instead:
 *
 *   0  cut for this shopper   -> surfaced first
 *   1  unisex                 -> still very much on offer, just below
 *   2  cut for another gender -> last, but never removed
 *
 * Returns null when there is nothing to rank by, which tells the caller to skip
 * the whole re-ordering path and use a plain indexed database sort instead.
 */
export const genderRanker = (viewerGender) => {
  // "other" and "prefer_not_to_say" get no re-ordering. Guessing on their behalf
  // would be worse than leaving the default order alone.
  if (viewerGender !== "women" && viewerGender !== "men") return null
  return (productGender) => {
    if (productGender === viewerGender) return 0
    if (productGender === "unisex") return 1
    return 2
  }
}
