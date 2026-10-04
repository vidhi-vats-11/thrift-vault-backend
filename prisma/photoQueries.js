/**
 * Unsplash search terms, one per curated archetype.
 *
 * The whole point of the generated catalogue is that a listing's photo depicts
 * what its name says, so these queries are deliberately narrow: "denim trucker
 * jacket", not "jacket". A broad query would hand a bomber photo to a trucker
 * listing and undo the guarantee.
 *
 * Keys are the exact archetype names from seedData.js. fetchPhotos.js warns if
 * the two ever drift apart.
 */
export const PHOTO_QUERIES = {
  // --- Jackets -------------------------------------------------------------
  "Y2K Windbreaker": "nylon windbreaker jacket",
  "Leather Trench Coat": "leather trench coat",
  "Denim Trucker Jacket": "denim jacket",
  "Black Leather Biker Jacket": "black leather biker jacket",
  "Tan Leather Jacket": "tan leather jacket",
  "Rust Bomber Jacket": "bomber jacket",
  "Quilted Down Puffer": "puffer jacket",
  "Brown Varsity Jacket": "varsity jacket",
  "Camel Wool Overcoat": "camel wool overcoat",
  "Royal Blue Suit Blazer": "blue blazer jacket",

  // --- Denim ---------------------------------------------------------------
  "Baggy Carpenter Denim": "carpenter work jeans",
  "Light Wash Mom Jeans": "light wash jeans",
  "Black Straight-Leg Jeans": "black jeans",
  "Distressed Denim Shorts": "denim shorts",

  // --- Tops ----------------------------------------------------------------
  "Cropped Graphic Tee": "graphic t-shirt",
  "Oversized Flannel Shirt": "flannel shirt",
  "Heavyweight Black Hoodie": "black hoodie",
  "White Crewneck Sweatshirt": "white sweatshirt",
  "Champagne Satin Shirt": "satin blouse",
  "Striped Knit Top": "striped knit top",
  "Khaki Linen Overshirt": "linen overshirt",
  "White Pique Polo": "white polo shirt",
  "White Cotton Henley": "henley shirt",
  "Navy Crewneck Sweatshirt": "navy sweatshirt",

  // --- Dresses -------------------------------------------------------------
  "Slip Satin Mini Dress": "satin slip dress",
  "Tiered Floral Gown": "floral gown dress",
  "Floral Midi Sundress": "floral midi dress",

  // --- Bottoms -------------------------------------------------------------
  "Low-Rise Cargo Pants": "cargo pants",
  "Pleated Mini Skirt": "pleated skirt",
  "Grey Wide-Leg Trousers": "wide leg trousers",
  "Black Tapered Trousers": "black trousers",
  "Grey Houndstooth Trousers": "houndstooth trousers",

  // --- Footwear ------------------------------------------------------------
  "Chunky Platform Sneakers": "chunky platform sneakers",
  "White Leather High-Tops": "white high top sneakers",
  "Brown Leather Lace-Up Boots": "brown leather boots",
  "Black Chelsea Lug Boots": "black chelsea boots",
  "Tan Leather Brogue Boots": "tan brogue shoes",
  "Brown Nubuck Work Boots": "suede work boots",

  // --- Knitwear ------------------------------------------------------------
  "Fair Isle Wool Cardigan": "patterned wool cardigan",
  "Chunky Ribbed Knit Sweater": "chunky knit sweater",

  // --- Accessories ---------------------------------------------------------
  "Beaded Statement Necklace": "beaded necklace",
  "Retro Bucket Hat": "bucket hat",
  "Woven Leather Tote": "leather tote bag",
  "Studded Crossbody Bag": "crossbody handbag",
  "Black Wayfarer Sunglasses": "black sunglasses",
  "Olive Wool Scarf": "wool scarf",
  "White Baseball Cap": "white baseball cap",
  "Chronograph Watch": "chronograph wristwatch",
  "Minimalist Leather-Strap Watch": "minimalist wristwatch leather strap",
  "Brown Leather Belt": "leather belt",
  "Rust Ribbed Beanie": "knit beanie hat",
}
