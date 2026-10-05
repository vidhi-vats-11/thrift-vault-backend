/**
 * Openverse search terms per archetype, ordered specific → broad.
 *
 * Openverse indexes a far smaller library than Unsplash, and narrow phrases
 * come back empty: "leather biker jacket", "chunky platform sneakers" and
 * "floral midi dress" all return zero results even with the license filter
 * wide open. So each archetype carries a chain — the fetcher walks it until it
 * has enough photos, keeping the most specific wording that actually returns
 * something.
 *
 * The cost of that fallback is precision: a biker-jacket listing may end up
 * with a photo of some other leather jacket. The garment type still matches,
 * which is the guarantee that matters, but this is the trade Openverse forces
 * and Unsplash does not.
 */
/**
 * Words that must appear in a result's title or tags for it to be accepted.
 *
 * Keyword search alone is not enough here. "windbreaker" returns an Israeli
 * tank (the Merkava's Windbreaker defence system) and a row of trees (a
 * windbreak); "tote" returns tote bags and also people carrying things. Every
 * candidate has to name the garment somewhere in its own metadata, or it is
 * discarded — a wrong photo is worse than a repeated one.
 */
/**
 * Hard rejections, applied before the required-word check. These are the false
 * positives a garment noun cannot filter out on its own: the Merkava tank's
 * "Windbreaker" defence system, agricultural windbreaks (rows of trees),
 * orthopaedic "boots", and scanned comics or diagrams that are catalogued as
 * photographs.
 */
export const EXCLUDE_WORDS = [
  "merkava", "idf", "tank", "military", "army", "missile", "turret",
  "shelterbelt", "windbreak:", "tree", "orchard", "grove", "shrub", "hedge",
  "plantation", "banana", "crop", "farm",
  "kafo", "orthosis", "orthotic", "brace", "prosthe",
  "comic", "cartoon", "diagram", "map", "poster", "logo", "sign",
]

export const REQUIRED_WORDS = {
  "Y2K Windbreaker": ["windbreaker", "anorak", "rain jacket", "jacket"],
  "Leather Trench Coat": ["trench", "coat", "overcoat"],
  "Denim Trucker Jacket": ["denim", "jean jacket", "jacket"],
  "Black Leather Biker Jacket": ["leather jacket", "biker", "motorcycle jacket", "jacket"],
  "Tan Leather Jacket": ["leather jacket", "jacket"],
  "Rust Bomber Jacket": ["bomber", "flight jacket", "jacket"],
  "Quilted Down Puffer": ["puffer", "down jacket", "quilted", "parka", "jacket"],
  "Brown Varsity Jacket": ["varsity", "letterman", "baseball jacket", "jacket"],
  "Camel Wool Overcoat": ["overcoat", "wool coat", "coat"],
  "Royal Blue Suit Blazer": ["blazer", "suit", "sport coat"],

  "Baggy Carpenter Denim": ["jeans", "denim", "trousers", "pants"],
  "Light Wash Mom Jeans": ["jeans", "denim"],
  "Black Straight-Leg Jeans": ["jeans", "denim"],
  "Distressed Denim Shorts": ["shorts", "denim", "cutoffs"],

  "Cropped Graphic Tee": ["t-shirt", "tshirt", "tee", "shirt"],
  "Oversized Flannel Shirt": ["flannel", "plaid shirt", "shirt"],
  "Heavyweight Black Hoodie": ["hoodie", "hooded", "sweatshirt"],
  "White Crewneck Sweatshirt": ["sweatshirt", "crewneck", "jumper"],
  "Champagne Satin Shirt": ["blouse", "satin", "shirt"],
  "Striped Knit Top": ["striped", "knit", "top", "shirt", "sweater"],
  "Khaki Linen Overshirt": ["linen", "overshirt", "shirt"],
  "White Pique Polo": ["polo"],
  "White Cotton Henley": ["henley", "shirt"],
  "Navy Crewneck Sweatshirt": ["sweatshirt", "crewneck", "jumper"],

  "Slip Satin Mini Dress": ["dress", "slip", "satin"],
  "Tiered Floral Gown": ["gown", "dress"],
  "Floral Midi Sundress": ["sundress", "dress"],

  "Low-Rise Cargo Pants": ["cargo", "trousers", "pants"],
  "Pleated Mini Skirt": ["skirt"],
  "Grey Wide-Leg Trousers": ["trousers", "pants", "slacks"],
  "Black Tapered Trousers": ["trousers", "pants", "slacks"],
  "Grey Houndstooth Trousers": ["houndstooth", "trousers", "pants"],

  "Chunky Platform Sneakers": ["sneaker", "trainer", "shoe", "platform"],
  "White Leather High-Tops": ["sneaker", "trainer", "shoe", "high top"],
  "Brown Leather Lace-Up Boots": ["boot"],
  "Black Chelsea Lug Boots": ["boot", "chelsea"],
  "Tan Leather Brogue Boots": ["brogue", "shoe", "oxford", "boot"],
  "Brown Nubuck Work Boots": ["boot", "work boot"],

  "Fair Isle Wool Cardigan": ["cardigan", "sweater", "knit", "jumper"],
  "Chunky Ribbed Knit Sweater": ["sweater", "knit", "jumper", "pullover"],

  "Beaded Statement Necklace": ["necklace", "bead", "pendant"],
  "Retro Bucket Hat": ["bucket hat", "hat"],
  "Woven Leather Tote": ["tote", "bag", "handbag", "purse"],
  "Studded Crossbody Bag": ["bag", "handbag", "purse", "crossbody"],
  "Black Wayfarer Sunglasses": ["sunglasses", "shades", "eyewear"],
  "Olive Wool Scarf": ["scarf"],
  "White Baseball Cap": ["cap", "hat"],
  "Chronograph Watch": ["watch", "chronograph", "wristwatch"],
  "Minimalist Leather-Strap Watch": ["watch", "wristwatch"],
  "Brown Leather Belt": ["belt"],
  "Rust Ribbed Beanie": ["beanie", "knit hat", "wool hat", "toque"],
}

export const OPENVERSE_QUERIES = {
  // --- Jackets -------------------------------------------------------------
  "Y2K Windbreaker": ["windbreaker", "nylon jacket", "jacket"],
  "Leather Trench Coat": ["trench coat", "leather coat", "coat"],
  "Denim Trucker Jacket": ["denim jacket"],
  "Black Leather Biker Jacket": ["biker jacket", "leather jacket"],
  "Tan Leather Jacket": ["leather jacket"],
  "Rust Bomber Jacket": ["bomber jacket", "jacket"],
  "Quilted Down Puffer": ["puffer jacket", "down jacket", "winter jacket"],
  "Brown Varsity Jacket": ["varsity jacket", "letterman jacket", "jacket"],
  "Camel Wool Overcoat": ["wool coat", "overcoat", "coat"],
  "Royal Blue Suit Blazer": ["blazer", "suit jacket"],

  // --- Denim ---------------------------------------------------------------
  "Baggy Carpenter Denim": ["work jeans", "jeans"],
  "Light Wash Mom Jeans": ["blue jeans", "jeans"],
  "Black Straight-Leg Jeans": ["black jeans", "jeans"],
  "Distressed Denim Shorts": ["denim shorts", "shorts"],

  // --- Tops ----------------------------------------------------------------
  "Cropped Graphic Tee": ["graphic t-shirt", "t-shirt"],
  "Oversized Flannel Shirt": ["flannel shirt", "plaid shirt"],
  "Heavyweight Black Hoodie": ["hoodie", "hooded sweatshirt"],
  "White Crewneck Sweatshirt": ["sweatshirt"],
  "Champagne Satin Shirt": ["satin blouse", "blouse"],
  "Striped Knit Top": ["striped shirt", "knit top"],
  "Khaki Linen Overshirt": ["linen shirt", "shirt"],
  "White Pique Polo": ["polo shirt"],
  "White Cotton Henley": ["henley shirt", "long sleeve shirt"],
  "Navy Crewneck Sweatshirt": ["sweatshirt"],

  // --- Dresses -------------------------------------------------------------
  "Slip Satin Mini Dress": ["slip dress", "satin dress", "dress"],
  "Tiered Floral Gown": ["gown", "floral dress", "dress"],
  "Floral Midi Sundress": ["sundress", "floral dress", "dress"],

  // --- Bottoms -------------------------------------------------------------
  "Low-Rise Cargo Pants": ["cargo pants", "cargo trousers"],
  "Pleated Mini Skirt": ["pleated skirt", "skirt"],
  "Grey Wide-Leg Trousers": ["wide leg trousers", "trousers"],
  "Black Tapered Trousers": ["black trousers", "trousers"],
  "Grey Houndstooth Trousers": ["houndstooth", "trousers"],

  // --- Footwear ------------------------------------------------------------
  "Chunky Platform Sneakers": ["platform shoes", "sneakers"],
  "White Leather High-Tops": ["high top sneakers", "sneakers"],
  "Brown Leather Lace-Up Boots": ["leather boots", "boots"],
  "Black Chelsea Lug Boots": ["chelsea boots", "boots"],
  "Tan Leather Brogue Boots": ["brogue shoes", "dress shoes"],
  "Brown Nubuck Work Boots": ["work boots", "boots"],

  // --- Knitwear ------------------------------------------------------------
  "Fair Isle Wool Cardigan": ["cardigan", "wool sweater"],
  "Chunky Ribbed Knit Sweater": ["knit sweater", "sweater"],

  // --- Accessories ---------------------------------------------------------
  "Beaded Statement Necklace": ["beaded necklace", "necklace"],
  "Retro Bucket Hat": ["bucket hat", "hat"],
  "Woven Leather Tote": ["tote bag", "leather bag"],
  "Studded Crossbody Bag": ["shoulder bag", "handbag"],
  "Black Wayfarer Sunglasses": ["sunglasses"],
  "Olive Wool Scarf": ["wool scarf", "scarf"],
  "White Baseball Cap": ["baseball cap", "cap"],
  "Chronograph Watch": ["chronograph wristwatch", "wristwatch"],
  "Minimalist Leather-Strap Watch": ["wristwatch", "watch"],
  "Brown Leather Belt": ["leather belt", "belt"],
  "Rust Ribbed Beanie": ["beanie", "knit hat"],
}
